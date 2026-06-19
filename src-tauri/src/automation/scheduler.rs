use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};
use chrono::Datelike;

use crate::automation::browser;
use crate::automation::day_plan::{DayPlan, PunchStatus};
use crate::automation::portal;
use crate::notifications::telegram;
use crate::utils::logging::emit_log;
use crate::utils::power;
use crate::utils::time;

/// Tentativas por batida antes de desistir e reagendar.
const MAX_PUNCH_RETRIES: u8 = 3;
/// Atraso (min) aplicado ao reagendar uma batida que esgotou as tentativas.
const RESCHEDULE_DELAY_MIN: i32 = 10;
/// Backoff quando o portal está indisponível (login/navegação falhou).
const PORTAL_DOWN_BACKOFF_SECS: u64 = 300;
/// Falhas LIMPAS seguidas (portal respondeu com erro) antes de reiniciar o
/// navegador como medida defensiva. Um timeout de navegação (sem resposta)
/// reinicia na hora, pois indica navegador travado.
const MAX_PORTAL_FAILURES_BEFORE_RESTART: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationConfig {
    pub schedule: serde_json::Value,
    pub folha: String,
    pub senha: String,
    pub telegram_bot_token: Option<String>,
    pub telegram_chat_id: Option<String>,
    pub pre_assigned_interval: bool,
    /// Modo simulação: percorre o dia sem registrar ponto de verdade.
    #[serde(default)]
    pub dry_run: bool,
    /// (Dry-run) força a falha de uma batida para exercitar o reagendamento.
    #[serde(default)]
    pub simulate_failure: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NextPunch {
    pub day_key: String,
    pub punch_type: String,
    pub time: String,
    pub datetime: chrono::NaiveDateTime,
}

pub struct AutomationManager {
    cancel_token: CancellationToken,
    is_running: Arc<Mutex<bool>>,
    /// Espelho síncrono de `is_running`, lido pelo handler de fechar-janela
    /// (minimizar-para-bandeja) sem precisar de lock async.
    running_flag: Arc<AtomicBool>,
}

impl AutomationManager {
    pub fn new(running_flag: Arc<AtomicBool>) -> Self {
        Self {
            cancel_token: CancellationToken::new(),
            is_running: Arc::new(Mutex::new(false)),
            running_flag,
        }
    }

    pub async fn is_running(&self) -> bool {
        *self.is_running.lock().await
    }

    pub async fn start(
        &mut self,
        app: AppHandle,
        config: AutomationConfig,
    ) -> Result<(), String> {
        let mut running = self.is_running.lock().await;
        if *running {
            return Err("Automação já está rodando.".to_string());
        }
        *running = true;
        self.running_flag.store(true, Ordering::Relaxed);
        drop(running);

        // Reset cancel token
        self.cancel_token = CancellationToken::new();
        let token = self.cancel_token.clone();
        let is_running = self.is_running.clone();
        let running_flag = self.running_flag.clone();

        emit_status(&app, true, "Iniciando automação...", Some("Preparando..."));
        emit_log(&app, "INFO", "--- Automação Iniciada ---");
        power::start_power_save_blocker();

        // Spawn the automation loop
        tokio::spawn(async move {
            if let Err(e) = run_automation_loop(&app, &config, &token).await {
                emit_log(&app, "ERRO", &format!("Erro na automação: {e}"));
            }

            // Cleanup
            let mut running = is_running.lock().await;
            *running = false;
            running_flag.store(false, Ordering::Relaxed);
            power::stop_power_save_blocker();
            emit_status(&app, false, "Automação interrompida.", None);
            emit_log(&app, "INFO", "--- Automação Efetivamente Parada ---");
        });

        Ok(())
    }

    pub async fn stop(&self) {
        self.cancel_token.cancel();
        emit_log_static("INFO", "Solicitação de parada recebida.");
    }
}

/// Por que o heartbeat encerrou.
enum LoopOutcome {
    /// Parada solicitada pelo usuário.
    Cancelled,
    /// O navegador ficou inutilizável (navegação travada/erros repetidos) e
    /// precisa ser reiniciado para a automação se recuperar.
    NeedsBrowserRestart,
}

/// Encerra o navegador de forma robusta: `close()` depende do handler CDP e pode
/// travar se o processo estiver preso. Damos timeout e, se estourar, `kill()`
/// força o encerramento. Coleta o processo para evitar zumbis.
async fn teardown_browser(
    app: &AppHandle,
    mut browser_instance: chromiumoxide::browser::Browser,
    handler: tokio::task::JoinHandle<()>,
) {
    emit_log(app, "INFO", "Fechando navegador...");
    match tokio::time::timeout(std::time::Duration::from_secs(8), browser_instance.close()).await {
        Ok(_) => {}
        Err(_) => {
            emit_log(app, "AVISO", "Fechamento normal travou; forçando encerramento do navegador.");
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), browser_instance.kill()).await;
        }
    }
    handler.abort();
    let _ = browser_instance.try_wait(); // coleta o processo encerrado (evita zumbi)
    emit_log(app, "INFO", "Navegador fechado.");
}

async fn run_automation_loop(
    app: &AppHandle,
    config: &AutomationConfig,
    cancel_token: &CancellationToken,
) -> Result<(), String> {
    // Step 1: Ensure Chromium is available
    let chromium_path = match browser::get_chromium_path(app) {
        Some(path) => {
            emit_log(app, "SUCESSO", "Chromium encontrado.");
            path
        }
        None => {
            emit_log(app, "INFO", "Chromium não encontrado. Iniciando download...");
            emit_status(app, true, "Baixando navegador...", Some("Download"));
            browser::download_chromium(app).await?
        }
    };

    if cancel_token.is_cancelled() {
        return Ok(());
    }

    let profile = browser::profile_dir(app);

    // Dry-run: execução única (sem loop de reinício).
    if config.dry_run {
        emit_status(app, true, "Iniciando navegador...", Some("Browser"));
        let (browser_instance, handler) =
            browser::launch_browser(chromium_path.clone(), profile.clone()).await?;
        emit_log(app, "SUCESSO", "Navegador iniciado com sucesso.");
        let result = simulate_day(app, &browser_instance, config, cancel_token).await;
        teardown_browser(app, browser_instance, handler).await;
        return result;
    }

    // Automação real: relança o navegador se ele ficar inutilizável (ex.: após
    // uma navegação abortada por timeout, que deixa o CDP num estado quebrado e
    // impede qualquer login subsequente). O perfil persistente preserva a sessão,
    // então o re-login após o restart continua rápido.
    loop {
        if cancel_token.is_cancelled() {
            return Ok(());
        }

        emit_status(app, true, "Iniciando navegador...", Some("Browser"));
        let (browser_instance, handler) =
            browser::launch_browser(chromium_path.clone(), profile.clone()).await?;
        emit_log(app, "SUCESSO", "Navegador iniciado com sucesso.");

        let outcome = automation_heartbeat_loop(app, &browser_instance, config, cancel_token).await;
        teardown_browser(app, browser_instance, handler).await;

        match outcome {
            Ok(LoopOutcome::Cancelled) => return Ok(()),
            Err(e) => return Err(e),
            Ok(LoopOutcome::NeedsBrowserRestart) => {
                if cancel_token.is_cancelled() {
                    return Ok(());
                }
                emit_log(app, "INFO", "Reiniciando o navegador para recuperar a automação...");
                emit_status(app, true, "Reiniciando navegador...", Some("Browser"));
                wait_or_cancel(cancel_token, std::time::Duration::from_secs(5)).await;
                continue;
            }
        }
    }
}

async fn automation_heartbeat_loop(
    app: &AppHandle,
    browser: &chromiumoxide::browser::Browser,
    config: &AutomationConfig,
    cancel_token: &CancellationToken,
) -> Result<LoopOutcome, String> {
    // Página logada persistente: reaproveitada entre ciclos enquanto a sessão
    // do portal continuar válida, evitando refazer login a cada verificação.
    // Só faz login completo no 1º ciclo ou quando a sessão expira.
    let mut session: Option<chromiumoxide::page::Page> = None;
    // Falhas LIMPAS seguidas; ao atingir o limite, pede restart do navegador.
    let mut portal_failures: u32 = 0;

    loop {
        if cancel_token.is_cancelled() {
            // Não fecha a página aqui: o teardown do navegador (com kill) cuida
            // disso. Retornar já garante que o Interromper conclua sem travar.
            return Ok(LoopOutcome::Cancelled);
        }

        // --- 1. Garantir página logada (reaproveita a sessão quando possível) ---
        emit_status(app, true, "Sincronizando pontos...", Some("Sync"));

        // Navegação SEM resposta (timeout) → navegador provavelmente travado
        // (estado quebrado após uma navegação abortada): reinicia o navegador já.
        macro_rules! restart_now {
            ($msg:expr) => {{
                notify_portal_down(app, config, $msg).await;
                emit_log(app, "AVISO", "Navegação sem resposta (provável navegador travado). Reiniciando o navegador...");
                return Ok(LoopOutcome::NeedsBrowserRestart);
            }};
        }
        // Falha LIMPA (portal respondeu com erro / sem rede detectada): backoff e
        // tenta de novo; após várias seguidas, reinicia o navegador por precaução.
        macro_rules! clean_fail {
            ($msg:expr) => {{
                portal_failures += 1;
                notify_portal_down(app, config, $msg).await;
                if portal_failures >= MAX_PORTAL_FAILURES_BEFORE_RESTART {
                    emit_log(app, "AVISO", "Falhas repetidas de acesso ao portal. Reiniciando o navegador...");
                    return Ok(LoopOutcome::NeedsBrowserRestart);
                }
                wait_or_cancel(cancel_token, std::time::Duration::from_secs(PORTAL_DOWN_BACKOFF_SECS)).await;
                continue;
            }};
        }

        // Login limpo com timeout + cancelamento. Em CANCELAMENTO retorna sem
        // fechar nada (o teardown do navegador cuida disso) — assim o Interromper
        // nunca trava num close pendurado. `$discard` é a página antiga a largar.
        macro_rules! fresh_login_or {
            ($discard:expr) => {
                match run_portal_op(cancel_token, portal::login_to_portal(browser, app, &config.folha, &config.senha)).await {
                    PortalOp::Cancelled => return Ok(LoopOutcome::Cancelled),
                    PortalOp::TimedOut => {
                        if let Some(p) = $discard { close_page_safe(p).await; }
                        restart_now!("tempo de login esgotado (sem resposta do portal)");
                    }
                    PortalOp::Done(Ok(np)) => {
                        if let Some(p) = $discard { close_page_safe(p).await; }
                        np
                    }
                    PortalOp::Done(Err(e)) => {
                        if let Some(p) = $discard { close_page_safe(p).await; }
                        clean_fail!(&e);
                    }
                }
            };
        }

        let page = match session.take() {
            // Já há uma página aberta: tenta reaproveitar a sessão (rápido,
            // sem reenviar credenciais).
            Some(p) => match run_portal_op(cancel_token, portal::reuse_session(&p, app)).await {
                PortalOp::Cancelled => return Ok(LoopOutcome::Cancelled),
                PortalOp::Done(Ok(true)) => p,
                // Sessão expirou: descarta a página e faz login limpo.
                PortalOp::Done(Ok(false)) => fresh_login_or!(Some(p)),
                PortalOp::TimedOut => {
                    // Navegação travou (navegador preso): reinicia o navegador.
                    close_page_safe(p).await;
                    restart_now!("tempo de reaproveitamento de sessão esgotado");
                }
                PortalOp::Done(Err(e)) => {
                    close_page_safe(p).await;
                    clean_fail!(&e);
                }
            },
            // 1º ciclo (ou após expiração): login completo.
            None => fresh_login_or!(None::<chromiumoxide::page::Page>),
        };

        let existing_points = match run_portal_op(cancel_token, portal::sync_initial_points(&page, app)).await {
            PortalOp::Cancelled => return Ok(LoopOutcome::Cancelled),
            PortalOp::TimedOut => {
                close_page_safe(page).await;
                restart_now!("tempo de sincronização esgotado");
            }
            PortalOp::Done(r) => {
                portal_failures = 0;
                r.unwrap_or_default()
            }
        };
        // A página fica viva entre ciclos: nos caminhos sem batida ela é
        // guardada em `session` (não fechada) para reaproveitar a sessão no
        // próximo ciclo; na batida é usada direto (sem 2º login).

        // --- 2. Montar/retomar o plano-do-dia e reconciliar contra o portal ---
        let plan_opt = load_or_build_plan(app, config, &existing_points);
        let now_iso = chrono::Local::now().to_rfc3339();

        let mut plan = match plan_opt {
            Some(mut p) => {
                p.reconcile(&existing_points, &now_iso);
                let _ = p.save(app);
                p.archive(app);
                p
            }
            None => {
                // Sem plano hoje (fim de semana / feriado / dia sem agenda).
                session = Some(page);
                wait_for_next_lookahead(app, config, &existing_points, cancel_token).await;
                continue;
            }
        };

        // Dia inválido: avisa e não registra hoje (melhoria: antes pulava em silêncio).
        if plan.invalid {
            let reason = plan.invalid_reason.clone().unwrap_or_default();
            emit_log(
                app,
                "AVISO",
                &format!("Dia '{}' inválido: {} Não vou registrar pontos hoje.", plan.day_key, reason),
            );
            session = Some(page);
            wait_for_next_lookahead(app, config, &existing_points, cancel_token).await;
            continue;
        }

        // --- 3. Selecionar a próxima batida acionável ---
        let idx = match plan.next_actionable() {
            Some(i) => i,
            None => {
                // Tudo registrado hoje → resumo diário no Telegram (uma vez).
                if plan.all_registered() && !plan.summary_sent {
                    let msg = format!("📋 Resumo do dia {}: {}", plan.date, plan.summary());
                    emit_log(app, "SUCESSO", &msg);
                    notify(app, config, &msg).await;
                    plan.summary_sent = true;
                    let _ = plan.save(app);
                    plan.archive(app);
                }
                emit_status(app, true, "Todas as batidas de hoje registradas.", None);
                session = Some(page);
                wait_for_next_lookahead(app, config, &existing_points, cancel_token).await;
                continue;
            }
        };

        let punch = plan.punches[idx].clone();
        let secs_until = match plan.datetime_for(&punch.planned_time) {
            Some(dt) => dt
                .signed_duration_since(chrono::Local::now().naive_local())
                .num_seconds(),
            None => {
                emit_log(app, "ERRO", &format!("Horário inválido para {}: {}", punch.punch_type, punch.planned_time));
                session = Some(page);
                wait_or_cancel(cancel_token, std::time::Duration::from_secs(300)).await;
                continue;
            }
        };

        // --- 4. Esperar até a hora (ou bater agora se já chegou/atrasou) ---
        if secs_until > 10 {
            let wait_secs = calc_heartbeat_interval(secs_until);
            emit_status(app, true, &format!("Aguardando {} às {}", punch.punch_type, punch.planned_time), None);
            emit_log(
                app,
                "INFO",
                &format!("Próxima verificação em {}s para {} @ {}", wait_secs, punch.punch_type, punch.planned_time),
            );
            session = Some(page);
            wait_or_cancel(cancel_token, std::time::Duration::from_secs(wait_secs as u64)).await;
            continue; // re-sincroniza e reavalia
        }

        // Hora de bater (batida vencida e ainda pendente também cai aqui = catch-up).
        // Usa a própria página da sessão (já logada e na tela) — sem 2º login.
        emit_log(app, "INFO", &format!("Hora de registrar: {} às {}!", punch.punch_type, punch.planned_time));
        emit_status(app, true, &format!("Registrando {}...", punch.punch_type), Some("Punch"));

        let punched = cancelable(
            cancel_token,
            perform_punch_with_retry(app, config, &mut plan, idx, &existing_points, cancel_token, &page),
        )
        .await;
        if punched.is_none() {
            // Interrompido durante a batida — retorna já (teardown fecha tudo).
            return Ok(LoopOutcome::Cancelled);
        }
        let _ = plan.save(app);
        plan.archive(app);

        // Mantém a sessão viva para os próximos ciclos (próxima batida / resumo).
        session = Some(page);
        wait_or_cancel(cancel_token, std::time::Duration::from_secs(60)).await;
    }
}

/// Tenta registrar uma batida com até `MAX_PUNCH_RETRIES` tentativas (backoff
/// exponencial). Em sucesso marca `Registered` e notifica. Ao esgotar: marca
/// `Failed`, envia screenshot via Telegram e reagenda (+`RESCHEDULE_DELAY_MIN`).
async fn perform_punch_with_retry(
    app: &AppHandle,
    config: &AutomationConfig,
    plan: &mut DayPlan,
    idx: usize,
    existing_points: &[String],
    cancel_token: &CancellationToken,
    page: &chromiumoxide::page::Page,
) {
    let punch_type = plan.punches[idx].punch_type.clone();
    let planned = plan.punches[idx].planned_time.clone();
    let prefix = if plan.dry_run { "[SIMULAÇÃO] " } else { "" };
    let mut last_error = String::from("desconhecido");

    for attempt in 1..=MAX_PUNCH_RETRIES {
        if cancel_token.is_cancelled() {
            return;
        }

        // Usa sempre a página persistente da sessão (já logada e na tela). A 1ª
        // tentativa reaproveita os pontos já sincronizados (sem pre-check); as
        // retentativas re-sincronizam o DOM (known=None) para reavaliar.
        let known: Option<&[String]> = if attempt == 1 { Some(existing_points) } else { None };

        plan.record_attempt(idx, None);
        emit_log(app, "INFO", &format!("Tentativa {attempt}/{MAX_PUNCH_RETRIES} de registrar {punch_type} @ {planned}"));

        let result = portal::perform_punch(page, app, &punch_type, &planned, known).await;

        match result {
            Ok(()) => {
                plan.mark_registered(idx, &chrono::Local::now().to_rfc3339());
                emit_log(app, "SUCESSO", &format!("{prefix}Ponto {punch_type} às {planned} registrado."));
                notify(app, config, &format!("{prefix}✅ Ponto {punch_type} às {planned} registrado com sucesso!")).await;
                return;
            }
            Err(e) => {
                last_error = e.clone();
                emit_log(app, "AVISO", &format!("Tentativa {attempt} falhou: {e}"));

                // Última tentativa: captura a tela (página ainda aberta) p/ Telegram.
                if attempt == MAX_PUNCH_RETRIES {
                    if let Ok(path) = portal::take_error_screenshot(page, app, &format!("punch_{punch_type}_falha")).await {
                        notify_photo(app, config, &path, &format!("{prefix}🔴 Falha ao registrar {punch_type} às {planned}")).await;
                    }
                }

                if attempt < MAX_PUNCH_RETRIES {
                    let backoff = 2 * attempt as u64;
                    wait_or_cancel(cancel_token, std::time::Duration::from_secs(backoff)).await;
                }
            }
        }
    }

    // Esgotou as tentativas → falha + reagenda batidas restantes.
    plan.mark_failed(idx, Some(last_error.clone()));
    emit_log(
        app,
        "ERRO",
        &format!("{prefix}Falha crítica após {MAX_PUNCH_RETRIES} tentativas em {punch_type}: {last_error}"),
    );
    notify(app, config, &format!("{prefix}🔴 Falha ao registrar ponto {punch_type} às {planned} após {MAX_PUNCH_RETRIES} tentativas: {last_error}")).await;

    plan.apply_reschedule(&punch_type, RESCHEDULE_DELAY_MIN, existing_points);

    // Resumo dos novos horários das batidas ainda não registradas.
    let novos: Vec<String> = plan
        .punches
        .iter()
        .filter(|p| p.status != PunchStatus::Registered)
        .map(|p| format!("{} → {}", p.punch_type, p.planned_time))
        .collect();
    emit_log(app, "AVISO", &format!("{prefix}Batidas reagendadas (+{RESCHEDULE_DELAY_MIN}min): {}", novos.join(", ")));
    notify(
        app,
        config,
        &format!("{prefix}⏰ Reagendei (+{RESCHEDULE_DELAY_MIN}min). Novos horários: {}", novos.join(", ")),
    )
    .await;
}

/// Carrega o plano de hoje persistido (se existir e for de hoje e do mesmo modo)
/// ou constrói um novo a partir da agenda + anchoring. `None` = sem plano hoje.
fn load_or_build_plan(
    app: &AppHandle,
    config: &AutomationConfig,
    existing_points: &[String],
) -> Option<DayPlan> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    if let Some(plan) = DayPlan::load(app, config.dry_run) {
        if plan.date == today && plan.pre_assigned_interval == config.pre_assigned_interval {
            return Some(plan);
        }
    }

    DayPlan::build_for_today(
        &config.schedule,
        existing_points,
        config.pre_assigned_interval,
        config.dry_run,
    )
}

/// Simulação one-shot do dia (dry-run): login + sync reais (read-only), monta o
/// plano com anchoring e percorre as batidas em tempo comprimido, simulando
/// sucesso/falha — sem nunca clicar em registrar. Notifica no Telegram com
/// prefixo [SIMULAÇÃO]. Persiste sob a chave dayPlanDryRun (descartável).
async fn simulate_day(
    app: &AppHandle,
    browser: &chromiumoxide::browser::Browser,
    config: &AutomationConfig,
    cancel_token: &CancellationToken,
) -> Result<(), String> {
    const PFX: &str = "[SIMULAÇÃO] ";
    emit_log(app, "INFO", &format!("{PFX}Iniciando simulação do dia — nenhum ponto será registrado de verdade."));
    emit_status(app, true, "Simulação: sincronizando pontos...", Some("Dry-run"));

    // 1. Login + sync reais (read-only). Se o portal falhar, simula sem pontos.
    let existing_points = match portal::login_to_portal(browser, app, &config.folha, &config.senha).await {
        Ok(page) => {
            let pts = portal::sync_initial_points(&page, app).await.unwrap_or_default();
            let _ = page.close().await;
            pts
        }
        Err(e) => {
            emit_log(app, "AVISO", &format!("{PFX}Sem acesso ao portal ({e}); simulando sem pontos já registrados."));
            Vec::new()
        }
    };

    if cancel_token.is_cancelled() {
        return Ok(());
    }

    // 2. Monta o plano-do-dia (dry-run) com anchoring e reconcilia.
    let mut plan = match DayPlan::build_for_today(
        &config.schedule,
        &existing_points,
        config.pre_assigned_interval,
        true,
    ) {
        Some(p) => p,
        None => {
            emit_log(app, "INFO", &format!("{PFX}Hoje não há batidas (fim de semana/feriado/sem agenda)."));
            return Ok(());
        }
    };
    plan.reconcile(&existing_points, &chrono::Local::now().to_rfc3339());
    let _ = plan.save(app);

    if plan.invalid {
        emit_log(app, "AVISO", &format!("{PFX}Dia inválido: {}", plan.invalid_reason.clone().unwrap_or_default()));
        return Ok(());
    }

    // 3. Percorre o plano em tempo comprimido.
    let mut injection_consumed = false;
    let mut guard = 0;
    while let Some(idx) = plan.next_actionable() {
        if cancel_token.is_cancelled() {
            return Ok(());
        }
        guard += 1;
        if guard > 30 {
            emit_log(app, "AVISO", &format!("{PFX}Limite de iterações atingido; encerrando simulação."));
            break;
        }

        let punch = plan.punches[idx].clone();
        emit_status(app, true, &format!("Simulando {} @ {}", punch.punch_type, punch.planned_time), Some("Dry-run"));
        emit_log(
            app,
            "INFO",
            &format!("{PFX}Próxima batida: {} @ {} (agenda: {})", punch.punch_type, punch.planned_time, punch.original_time),
        );
        wait_or_cancel(cancel_token, std::time::Duration::from_millis(1500)).await;

        let inject = config.simulate_failure.as_deref() == Some(punch.punch_type.as_str()) && !injection_consumed;
        if inject {
            injection_consumed = true;
            for attempt in 1..=MAX_PUNCH_RETRIES {
                plan.record_attempt(idx, Some("falha injetada".into()));
                emit_log(app, "AVISO", &format!("{PFX}Tentativa {attempt}/{MAX_PUNCH_RETRIES} de {} falhou (injetada).", punch.punch_type));
                wait_or_cancel(cancel_token, std::time::Duration::from_millis(500)).await;
            }
            plan.mark_failed(idx, Some("falha injetada".into()));
            notify(app, config, &format!("{PFX}🔴 Falha simulada em {} após {MAX_PUNCH_RETRIES} tentativas.", punch.punch_type)).await;

            plan.apply_reschedule(&punch.punch_type, RESCHEDULE_DELAY_MIN, &existing_points);
            let novos: Vec<String> = plan.punches.iter().filter(|p| p.status != PunchStatus::Registered).map(|p| format!("{} → {}", p.punch_type, p.planned_time)).collect();
            emit_log(app, "AVISO", &format!("{PFX}Reagendado (+{RESCHEDULE_DELAY_MIN}min): {}", novos.join(", ")));
            notify(app, config, &format!("{PFX}⏰ Reagendei. Novos horários: {}", novos.join(", "))).await;
            let _ = plan.save(app);
            continue;
        }

        // Sucesso simulado.
        plan.mark_registered(idx, &chrono::Local::now().to_rfc3339());
        emit_log(app, "SUCESSO", &format!("{PFX}Registraria {} @ {} agora.", punch.punch_type, punch.planned_time));
        notify(app, config, &format!("{PFX}✅ Ponto {} às {} registrado (simulado).", punch.punch_type, punch.planned_time)).await;
        let _ = plan.save(app);
    }

    // 4. Resumo.
    let resumo: Vec<String> = plan
        .punches
        .iter()
        .map(|p| format!("{} {} [{:?}]", p.punch_type, p.planned_time, p.status))
        .collect();
    emit_log(app, "SUCESSO", &format!("{PFX}Simulação concluída. Plano final: {}", resumo.join(" | ")));
    emit_status(app, true, "Simulação concluída.", None);
    notify(app, config, &format!("{PFX}📋 Simulação do dia concluída: {}", resumo.join(", "))).await;
    Ok(())
}

/// Sem batida acionável hoje: usa o lookahead multi-dia para esperar até a
/// próxima batida futura (ou 30min se não houver). Quando o dia virar, o plano
/// é reconstruído no próximo ciclo.
async fn wait_for_next_lookahead(
    app: &AppHandle,
    config: &AutomationConfig,
    existing_points: &[String],
    cancel_token: &CancellationToken,
) {
    match get_next_punch(&config.schedule, existing_points, config.pre_assigned_interval) {
        Some(p) => {
            let secs = p
                .datetime
                .signed_duration_since(chrono::Local::now().naive_local())
                .num_seconds()
                .max(5);
            let wait_secs = calc_heartbeat_interval(secs);
            emit_status(app, true, &format!("Próxima batida: {} {} às {}", p.day_key, p.punch_type, p.time), None);
            wait_or_cancel(cancel_token, std::time::Duration::from_secs(wait_secs as u64)).await;
        }
        None => {
            emit_log(app, "INFO", "Nenhuma batida próxima. Verificando novamente em 30 minutos.");
            emit_status(app, true, "Sem batidas pendentes. Aguardando...", None);
            wait_or_cancel(cancel_token, std::time::Duration::from_secs(1800)).await;
        }
    }
}

/// Notifica no Telegram (silencioso se token/chat_id ausentes).
async fn notify(app: &AppHandle, config: &AutomationConfig, message: &str) {
    if let (Some(token), Some(chat_id)) = (&config.telegram_bot_token, &config.telegram_chat_id) {
        if !token.is_empty() && !chat_id.is_empty() {
            if let Err(e) = telegram::send_text(token, chat_id, message).await {
                emit_log(app, "DEBUG", &format!("Falha ao notificar no Telegram: {e}"));
            }
        }
    }
}

/// Envia um screenshot no Telegram (silencioso se token/chat_id ausentes).
async fn notify_photo(app: &AppHandle, config: &AutomationConfig, path: &std::path::Path, caption: &str) {
    if let (Some(token), Some(chat_id)) = (&config.telegram_bot_token, &config.telegram_chat_id) {
        if !token.is_empty() && !chat_id.is_empty() {
            if let Err(e) = telegram::send_photo(token, chat_id, path, caption).await {
                emit_log(app, "DEBUG", &format!("Falha ao enviar screenshot no Telegram: {e}"));
            }
        }
    }
}

/// Trata indisponibilidade do portal: loga e notifica (backoff é do chamador).
async fn notify_portal_down(app: &AppHandle, config: &AutomationConfig, error: &str) {
    emit_log(app, "ERRO", &format!("Portal inacessível (login/navegação falhou): {error}"));
    emit_status(app, true, "Portal indisponível. Nova tentativa em 5min...", Some("Portal-down"));
    notify(
        app,
        config,
        &format!("⚠️ Não consegui acessar o portal: {error}\nNova tentativa em 5 minutos."),
    )
    .await;
}

/// Calculate adaptive heartbeat interval
fn calc_heartbeat_interval(secs_remaining: i64) -> i64 {
    if secs_remaining > 300 {
        300 // 5 minutes
    } else if secs_remaining > 60 {
        60 // 1 minute
    } else {
        secs_remaining.max(5) // At least 5 seconds
    }
}

/// Wait for a duration, but return early if cancelled
async fn wait_or_cancel(token: &CancellationToken, duration: std::time::Duration) {
    tokio::select! {
        _ = token.cancelled() => {}
        _ = tokio::time::sleep(duration) => {}
    }
}

/// Executa um future tornando-o cancelável: retorna `Some(resultado)` quando ele
/// completa, ou `None` se o `cancel_token` for acionado antes. Usado para que o
/// botão Interromper interrompa imediatamente operações longas do portal
/// (login, reuse, sync, batida) — que internamente usam `sleep` não-cancelável.
async fn cancelable<T, F>(token: &CancellationToken, fut: F) -> Option<T>
where
    F: std::future::Future<Output = T>,
{
    tokio::select! {
        _ = token.cancelled() => None,
        v = fut => Some(v),
    }
}

/// Tempo máximo para uma operação de navegação no portal (login/reuse/sync). Se
/// estourar — ex.: a internet caiu no meio e o navegador fica esperando a
/// navegação para sempre — tratamos como portal indisponível e caímos no
/// backoff, em vez de travar o loop indefinidamente.
const PORTAL_OP_TIMEOUT_SECS: u64 = 90;

/// Resultado de uma operação de portal sujeita a timeout + cancelamento.
enum PortalOp<T> {
    Done(T),
    Cancelled,
    TimedOut,
}

/// Roda uma operação de portal com timeout (`PORTAL_OP_TIMEOUT_SECS`) E
/// cancelamento. Garante que nada — nem uma navegação pendurada sem rede — segure
/// o loop: ou completa, ou o usuário interrompe, ou estoura o tempo.
async fn run_portal_op<T, F>(token: &CancellationToken, fut: F) -> PortalOp<T>
where
    F: std::future::Future<Output = T>,
{
    tokio::select! {
        _ = token.cancelled() => PortalOp::Cancelled,
        r = tokio::time::timeout(std::time::Duration::from_secs(PORTAL_OP_TIMEOUT_SECS), fut) => {
            match r {
                Ok(v) => PortalOp::Done(v),
                Err(_) => PortalOp::TimedOut,
            }
        }
    }
}

/// Fecha uma página com timeout. Se o navegador estiver travado (ex.: navegação
/// pendurada sem rede), `close()` pode não responder — o timeout evita que isso
/// segure o loop.
async fn close_page_safe(page: chromiumoxide::page::Page) {
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), page.close()).await;
}

/// Determine the next punch to make
pub fn get_next_punch(
    schedule: &serde_json::Value,
    existing_points: &[String],
    pre_assigned_interval: bool,
) -> Option<NextPunch> {
    let now = chrono::Local::now();

    // Iterate through next 7 days (including today)
    for day_offset in 0..7 {
        let check_date = now.date_naive() + chrono::Duration::days(day_offset);
        let weekday = check_date.weekday();

        // Skip weekends
        if !time::is_weekday(weekday) {
            continue;
        }

        let day_key = time::weekday_pt(weekday).to_string();

        // Get schedule entry for this day
        let day_entry = match schedule.get(&day_key) {
            Some(entry) => entry,
            None => continue,
        };

        // Check if it's a holiday
        if day_entry.get("feriado").and_then(|v| v.as_bool()).unwrap_or(false) {
            continue;
        }

        // Get punch order
        let punch_order: Vec<&str> = if pre_assigned_interval {
            vec!["entrada1", "saida2"]
        } else {
            vec!["entrada1", "saida1", "entrada2", "saida2"]
        };

        for punch_type in punch_order {
            let time_str = match day_entry.get(punch_type).and_then(|v| v.as_str()) {
                Some(t) if !t.is_empty() => t,
                _ => continue,
            };

            let parts: Vec<&str> = time_str.split(':').collect();
            if parts.len() != 2 {
                continue;
            }
            let hours: u32 = parts[0].parse().unwrap_or(0);
            let minutes: u32 = parts[1].parse().unwrap_or(0);

            let punch_datetime = check_date
                .and_hms_opt(hours, minutes, 0)
                .unwrap_or_else(|| check_date.and_hms_opt(0, 0, 0).unwrap());

            // Skip if time already passed today
            if day_offset == 0 && punch_datetime < now.naive_local() {
                continue;
            }

            // Skip if this punch is already registered (with ±5 min tolerance)
            if day_offset == 0 {
                let target_mins = (hours * 60 + minutes) as i32;
                let already_exists = existing_points.iter().any(|ep| {
                    if let Some(ep_mins) = crate::automation::portal::parse_time_minutes(ep) {
                        (ep_mins - target_mins).abs() <= 5
                    } else {
                        false
                    }
                });
                if already_exists {
                    continue;
                }
            }

            return Some(NextPunch {
                day_key,
                punch_type: punch_type.to_string(),
                time: time_str.to_string(),
                datetime: punch_datetime,
            });
        }
    }

    None
}

fn emit_status(app: &AppHandle, is_running: bool, message: &str, task: Option<&str>) {
    let _ = app.emit(
        "automation-status",
        serde_json::json!({
            "isRunning": is_running,
            "statusMessage": message,
            "currentTask": task,
        }),
    );
}

fn emit_log_static(level: &str, message: &str) {
    match level {
        "ERRO" => log::error!("{message}"),
        "AVISO" => log::warn!("{message}"),
        _ => log::info!("{message}"),
    }
}
