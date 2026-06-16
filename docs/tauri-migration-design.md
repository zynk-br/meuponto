# Meu Ponto — Conclusão da migração Tauri + melhorias de inteligência

> Documento de design validado via brainstorming. Fonte da verdade para a implementação.
> Branch: `feat/tauri-v2-migration`. Data: 2026-06-16.

## Resumo do entendimento

- Completar a migração Electron→Tauri e elevar a inteligência/confiabilidade, em **duas fases**: (1) paridade restaurando os gaps críticos, (2) melhorias sobre base estável.
- A migração atual é "dá pra": o caminho feliz funciona, mas perdeu a camada de resiliência e inteligência de agendamento que era o diferencial.
- Usuário: você e demais usuários que dependem do registro automático e confiável de ponto no portal Central do Funcionário.
- **Não-objetivos (agora):** auto-updater (por último, depende de infra externa); anti-detecção/humanização de horários; serviço daemon de fundo (escolhido tray).

## Premissas

- Plataforma principal macOS; Windows secundário; Linux best-effort.
- App single-user desktop, sem backend. Performance não é gargalo.
- Credenciais no keyring do SO; token Telegram nas settings (não hardcoded). Nenhum segredo novo no repo.
- Estado do dia persistido via `tauri-plugin-store`.
- Compatibilidade: manter formato atual de `settings`/`schedule` no store.
- Commits incrementais por fase; commit/push só sob pedido.

## Gaps confirmados na auditoria

**Críticos (regressões):**
1. **Anchoring é código morto** — `anchoring.rs` (`calculate_anchored_targets`, `extract_schedule_parameters`, `reschedule_with_delay`) implementado e testado, mas nunca chamado pelo scheduler.
2. **Auto-updater 100% inerte** — backend não emite eventos, `downloadUpdate`/`installUpdate` são stubs, `pubkey` vazio. (Diferido.)
3. **Retry/anti-falha ausente** — em falha, o scheduler só loga + Telegram texto; a batida cujo horário passou é abandonada para sempre. Sem retry, sem reschedule, sem screenshot.

**Médios:**
4. Screenshots de erro capturados mas `send_photo` nunca chamado.
5. `CustomTitleBar.tsx` chama `window.electronAPI.*` (órfão, nunca importado).

**Limpeza:** resíduos Electron no repo.

## Decisão de arquitetura: DayPlan + reconciliação (Abordagem B)

O `automation_heartbeat_loop` passa a operar sobre um **DayPlan** explícito e persistido, reconciliado contra o portal a cada ciclo (portal = fonte da verdade). Alternativas consideradas: A (recálculo a cada ciclo + log; observabilidade parafusada) e C (event-sourcing; overkill, rejeitada por YAGNI).

### Modelo de dados

```rust
struct DayPlan {
    date: String,              // "YYYY-MM-DD"
    dry_run: bool,
    punches: Vec<PlannedPunch>,
    created_at: String,
    last_reconciled_at: String,
}
struct PlannedPunch {
    punch_type: String,        // entrada1 | saida1 | entrada2 | saida2
    planned_time: String,      // "HH:MM" com anchoring aplicado
    original_time: String,     // "HH:MM" da agenda crua (auditoria)
    status: PunchStatus,       // Pending | Registered | Failed | Rescheduled | Skipped
    attempts: u8,
    last_error: Option<String>,
    registered_at: Option<String>,
}
enum PunchStatus { Pending, Registered, Failed, Rescheduled, Skipped }
```

- Nasce no início do dia: agenda do dia + anchoring sobre pontos já existentes no portal.
- Persistido na chave `dayPlan` do store (não toca `settings`/`schedule`).
- Reconciliação por ciclo: sync real + marca `Registered` o que casar (±5min), inclusive batidas manuais.

### Pré-assinalação de intervalo (modo de primeira classe)

Quando ativo, o DayPlan tem **apenas 2 batidas**: `entrada1` e `saida2` (S1/E2 não existem no plano). Propaga para:
- Anchoring: `entrada1` registrada → `saida2 = entrada1 + jornada + almoço` (jornada/almoço derivados da agenda completa).
- Reschedule: falhou `entrada1` → adia `entrada1` + `saida2`; falhou `saida2` → adia só `saida2`.
- Reconciliação e validação: só E1↔S2.

### Laço como máquina de estados

A cada ciclo: reconcilia → seleciona próxima `Pending`/`Failed` cujo horário chegou (dispara a ≤10s; senão espera adaptativa 5min/1min/5s) → executa (ou simula).

- **Retry:** até 3 tentativas/batida, backoff exponencial `2s × tentativa`, persistindo `attempts`/`last_error`.
- **Esgotou retry:** `Failed` → envia screenshot via Telegram (`send_photo`) → `reschedule_with_delay(+10min)` na batida + dependentes → volta a `Pending` com novo horário + notifica.
- **Portal fora do ar** (timeout login/navegação, distinto de falha de clique): **notifica + backoff 5min**, sem consumir retry nem disparar reschedule.
- Cancelamento via `CancellationToken` (mantido).

### Recuperação ao reiniciar + tray

- Ao abrir: se `dayPlan.date == hoje` e `automationWasRunning`, retoma automático (recarrega plano + reconcilia + continua). Se `date != hoje`, descarta e cria novo.
- **Tray** (`#[cfg(desktop)]`, permissão `tray`): menu Abrir / Status / Pausar-Retomar / Sair. X minimiza pra bandeja com automação ativa; "Sair" encerra. Intercepta `CloseRequested`.
- **Autostart** opt-in via `tauri-plugin-autostart` (toggle nas Settings, off por padrão).

### Modo dry-run / simulação

- Toggle na UI; DayPlan com `dry_run: true`. Fluxo idêntico ao real exceto o clique final de registrar (`perform_punch` ganha parâmetro `dry_run` que curto-circuita clique + verificação).
- **Tempo comprimido:** salta entre batidas (espera curta fixa) pra percorrer o dia em segundos.
- **Injeção de falha** ("simular falha na batida X") pra exercitar retry→reschedule.
- Telegram disparado com prefixo `[SIMULAÇÃO]`. DayPlan dry-run separado/descartável (não vira histórico real).

### Validação de agenda (Rust, proativa)

- Regras: ordem cronológica (`E1<S1<E2<S2`, ou `E1<S2` no modo pré-assinalação); jornada/almoço coerentes; feriado sem horários; campos vazios/malformados.
- Bloqueia início com mensagem **por dia** ("Terça: Saída 1 antes da Entrada 1").
- Melhoria: dia inválido deixa de ser pulado silenciosamente — passa a avisar qual e por quê.

### Observabilidade

- **Histórico:** DayPlan arquivado por dia em `punchHistory`; UI mostra "o que aconteceu hoje/últimos dias".
- **Resumo diário no Telegram** ao concluir o último ponto (✅ registradas + horários, ⚠️ reagendamentos, 🔴 falhas).
- Screenshots de falha no fluxo de retry.

### Limpeza

- **Remover:** `electron/`, `electron.vite.config.ts`, `out/`, `src/renderer/components/CustomTitleBar.tsx`, `metadata.json`.
- **Preservar:** `build-mac.sh`, `build-win.sh`, `certificate.p12`.
- ⚠️ Risco registrado: `build-mac.sh` versiona segredos reais (Apple app-specific password, `CSC_KEY_PASSWORD`, `GH_TOKEN`). Recomendado revogar e mover pra Secrets — **sem ação minha nos arquivos** por instrução do usuário.

### Testes

- Unitários Rust: anchoring, reschedule nos 2 modos, `get_next_punch`, montagem/reconciliação do DayPlan, regras de validação.
- Browser: `test_sync_points` (leitura) + dry-run.

## Decision Log

| # | Decisão | Alternativas | Por quê |
|---|---------|--------------|---------|
| 1 | Paridade primeiro, depois melhorias | Redesenhar tudo / só melhorias | Menor risco, entregas verificáveis |
| 2 | Frentes Fase 2: resiliência + observabilidade + validação | incluir anti-detecção | Escolha do usuário |
| 3 | DayPlan persistido + reconciliação (B) | A (log), C (event-sourcing) | Fase 2 toda depende de plano explícito; reconciliação mantém risco baixo |
| 4 | Tray + minimize-to-tray + autostart opcional | só janela / daemon | Equilíbrio confiabilidade × complexidade |
| 5 | Pré-assinalação molda DayPlan (2 batidas) | tratar como borda | Sincronismo E1↔S2 é o que importa no modo |
| 6 | Retry 3×/backoff + reschedule(+10min) + screenshot | abandonar (atual) | Restaura paridade Electron, fiado ao DayPlan |
| 7 | Portal-down: notifica + backoff 5min | retry imediato / backoff longo | Decisão do usuário |
| 8 | Recuperação via dayPlan + reconciliação | sem recovery | Resiliência a reinício |
| 9 | Dry-run reusa fluxo real menos clique; tempo comprimido; injeta falha; Telegram `[SIMULAÇÃO]` | sem dry-run | Validação sem risco de bater ponto |
| 10 | Validação no Rust, mensagens por-dia | só no frontend | Testável; avisa em vez de pular |
| 11 | Updater diferido | implementar já | Depende de infra/chaves externas |
| 12 | Preservar build-mac.sh/build-win.sh/certificate.p12 | remover | Instrução do usuário |

## Plano de implementação (faseado)

**Fase 1 — Paridade**
1. Módulo `day_plan` (struct + persistência no store + montagem a partir de agenda+anchoring+pontos).
2. Reconciliação contra portal no laço.
3. Fiar anchoring no nascimento do DayPlan (incl. modo pré-assinalação).
4. Retry 3×/backoff + `reschedule_with_delay` + `send_photo` (screenshot) no scheduler.
5. Classe de erro "portal-down" → notifica + backoff 5min.
6. Limpeza dos resíduos Electron.
7. Testes unitários da lógica nova.

**Fase 2 — Inteligência**
8. Recuperação ao reiniciar (retoma dayPlan do dia).
9. Tray + minimize-to-tray + `CloseRequested` + autostart opt-in.
10. Validação de agenda no Rust + mensagens por-dia na UI.
11. Dry-run (parâmetro em `perform_punch`, tempo comprimido, injeção de falha, Telegram `[SIMULAÇÃO]`).
12. Observabilidade: histórico (`punchHistory`) + resumo diário no Telegram + UI de histórico.

**Fase 3 — Diferida**
13. Auto-updater (cliente + chaves + CI), quando priorizado.
