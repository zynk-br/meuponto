use std::sync::atomic::{AtomicBool, Ordering};

static POWER_SAVE_ACTIVE: AtomicBool = AtomicBool::new(false);

/// App Nap (macOS): o caffeinate abaixo impede o sleep do SISTEMA, mas não a
/// suspensão do PRÓPRIO processo (App Nap / pressão de memória), que congela os
/// timers e atrasaria as batidas. Declarar uma atividade LatencyCritical via
/// NSProcessInfo mantém o app fora do App Nap e sem coalescing de timers
/// enquanto a automação estiver rodando.
#[cfg(target_os = "macos")]
mod app_nap {
    use objc2::rc::Retained;
    use objc2::runtime::{NSObjectProtocol, ProtocolObject};
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
    use std::sync::Mutex;

    /// Segurar o token retornado é o que mantém a atividade viva. A API do
    /// NSProcessInfo é thread-safe, mas o binding não marca o objeto como Send.
    struct Token(Retained<ProtocolObject<dyn NSObjectProtocol>>);
    unsafe impl Send for Token {}

    static ACTIVITY: Mutex<Option<Token>> = Mutex::new(None);

    pub fn begin() {
        let mut guard = ACTIVITY.lock().unwrap();
        if guard.is_none() {
            let token = NSProcessInfo::processInfo().beginActivityWithOptions_reason(
                NSActivityOptions::UserInitiatedAllowingIdleSystemSleep
                    | NSActivityOptions::LatencyCritical,
                &NSString::from_str("Automação de ponto aguardando o horário da batida"),
            );
            *guard = Some(Token(token));
        }
    }

    pub fn end() {
        if let Some(Token(token)) = ACTIVITY.lock().unwrap().take() {
            // SAFETY: o token veio de beginActivityWithOptions e é usado uma única vez.
            unsafe { NSProcessInfo::processInfo().endActivity(&token) };
        }
    }
}

/// Prevent the system from sleeping (called when automation starts)
pub fn start_power_save_blocker() {
    if POWER_SAVE_ACTIVE.load(Ordering::Relaxed) {
        return; // Already active
    }

    #[cfg(target_os = "macos")]
    {
        app_nap::begin();
        // Use IOPMAssertionCreateWithName via caffeinate subprocess
        // This is simpler than FFI and works reliably
        std::thread::spawn(|| {
            let _ = std::process::Command::new("caffeinate")
                .args(["-di", "-w", &std::process::id().to_string()])
                .spawn();
        });
    }

    #[cfg(target_os = "windows")]
    {
        // SetThreadExecutionState to prevent sleep
        #[link(name = "kernel32")]
        extern "system" {
            fn SetThreadExecutionState(flags: u32) -> u32;
        }
        const ES_CONTINUOUS: u32 = 0x80000000;
        const ES_SYSTEM_REQUIRED: u32 = 0x00000001;
        const ES_AWAYMODE_REQUIRED: u32 = 0x00000040;

        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED);
        }
    }

    POWER_SAVE_ACTIVE.store(true, Ordering::Relaxed);
    log::debug!("Power save blocker ativado");
}

/// Allow the system to sleep again (called when automation stops)
pub fn stop_power_save_blocker() {
    if !POWER_SAVE_ACTIVE.load(Ordering::Relaxed) {
        return; // Not active
    }

    #[cfg(target_os = "windows")]
    {
        #[link(name = "kernel32")]
        extern "system" {
            fn SetThreadExecutionState(flags: u32) -> u32;
        }
        const ES_CONTINUOUS: u32 = 0x80000000;

        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }

    // On macOS, caffeinate was started with -w (wait for PID), so it will
    // stop when the app exits. For mid-session stop, we kill the caffeinate process.
    #[cfg(target_os = "macos")]
    {
        app_nap::end();
        let _ = std::process::Command::new("pkill")
            .args(["-f", &format!("caffeinate.*{}", std::process::id())])
            .output();
    }

    POWER_SAVE_ACTIVE.store(false, Ordering::Relaxed);
    log::debug!("Power save blocker desativado");
}
