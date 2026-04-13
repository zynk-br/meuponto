const KEYRING_SERVICE: &str = "MeuPontoAutomatizado";

#[tauri::command]
pub fn get_credential(account: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
        .map_err(|e| format!("Erro ao acessar keyring: {e}"))?;

    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Erro ao obter credencial para {account}: {e}")),
    }
}

#[tauri::command]
pub fn set_credential(account: String, password: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
        .map_err(|e| format!("Erro ao acessar keyring: {e}"))?;

    entry
        .set_password(&password)
        .map_err(|e| format!("Erro ao salvar credencial para {account}: {e}"))
}

#[tauri::command]
pub fn delete_credential(account: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &account)
        .map_err(|e| format!("Erro ao acessar keyring: {e}"))?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone
        Err(e) => Err(format!("Erro ao excluir credencial para {account}: {e}")),
    }
}
