use std::{io::{Cursor, ErrorKind, Read, Write}, sync::Arc, time::Duration};
use rustls::{ClientConfig, ClientConnection, RootCertStore, pki_types::{ServerName, UnixTime}, time_provider::TimeProvider};
use wasm_bindgen::prelude::*;

#[derive(Debug)]
struct WorkerClock;
impl TimeProvider for WorkerClock {
    fn current_time(&self) -> Option<UnixTime> {
        let ms = js_sys::Date::now();
        if !ms.is_finite() || ms < 0.0 { return None; }
        Some(UnixTime::since_unix_epoch(Duration::from_millis(ms as u64)))
    }
}
fn error(e: impl std::fmt::Display) -> JsValue { JsValue::from_str(&e.to_string()) }

#[wasm_bindgen]
pub struct TlsClient {
    connection: ClientConnection,
    failed: bool,
}

impl TlsClient {
    fn ensure_active(&self) -> Result<(), JsValue> {
        if self.failed { Err(error("TLS connection failed")) } else { Ok(()) }
    }
}

#[wasm_bindgen]
impl TlsClient {
    #[wasm_bindgen(constructor)]
    pub fn new(hostname: String) -> Result<TlsClient, JsValue> {
        let server_name = ServerName::try_from(hostname).map_err(error)?;
        let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let mut config = ClientConfig::builder_with_details(
            Arc::new(rustls::crypto::ring::default_provider()), Arc::new(WorkerClock),
        ).with_safe_default_protocol_versions().map_err(error)?
            .with_root_certificates(roots).with_no_client_auth();
        config.resumption = rustls::client::Resumption::disabled();
        config.enable_early_data = false;
        let mut connection = ClientConnection::new(Arc::new(config), server_name).map_err(error)?;
        connection.set_buffer_limit(Some(65_536));
        Ok(TlsClient { connection, failed: false })
    }
    pub fn handshaking(&self) -> Result<bool, JsValue> {
        self.ensure_active()?;
        Ok(self.connection.is_handshaking())
    }
    pub fn take_tls(&mut self) -> Result<Vec<u8>, JsValue> {
        self.ensure_active()?;
        let mut bytes = Vec::new();
        while self.connection.wants_write() { self.connection.write_tls(&mut bytes).map_err(error)?; }
        Ok(bytes)
    }
    pub fn receive_tls(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        self.ensure_active()?;
        if bytes.len() > 65_536 { self.failed = true; return Err(error("TLS input too large")); }
        let result = self.process_tls(bytes);
        if result.is_err() { self.failed = true; }
        result
    }
    pub fn write_application(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        self.ensure_active()?;
        if self.connection.is_handshaking() { return Err(error("TLS handshake incomplete")); }
        if bytes.len() > 16_384 { return Err(error("TLS application chunk too large")); }
        let result = self.connection.writer().write_all(bytes).map_err(error);
        if result.is_err() { self.failed = true; }
        result
    }
    pub fn read_application(&mut self) -> Result<Vec<u8>, JsValue> {
        self.ensure_active()?;
        let mut bytes = vec![0; 16_384];
        match self.connection.reader().read(&mut bytes) {
            Ok(n) => { bytes.truncate(n); Ok(bytes) },
            Err(e) if e.kind() == ErrorKind::WouldBlock => Ok(Vec::new()),
            Err(e) => { self.failed = true; Err(error(e)) },
        }
    }
}

impl TlsClient {
    fn process_tls(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        let mut input = Cursor::new(bytes);
        while input.position() < bytes.len() as u64 {
            let n = self.connection.read_tls(&mut input).map_err(error)?;
            if n == 0 { return Err(error("TLS input made no progress")); }
            self.connection.process_new_packets().map_err(error)?;
        }
        Ok(())
    }
}
