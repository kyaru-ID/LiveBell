//! 全部普通 B 站 API 共用连接池，并为连接、读取和整次请求设置上限。
use std::sync::LazyLock;
use std::time::Duration;

static CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .read_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(6))
        .build()
        .map_err(|error| format!("网络客户端初始化失败：{error}"))
});

pub(crate) fn client() -> Result<&'static reqwest::Client, String> {
    CLIENT.as_ref().map_err(Clone::clone)
}

#[cfg(test)]
mod tests {
    #[test]
    fn reuses_the_same_client() {
        assert!(std::ptr::eq(
            super::client().unwrap(),
            super::client().unwrap()
        ));
    }

    #[tokio::test]
    async fn a_stalled_response_body_times_out() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut request = [0; 2048];
            let _ = stream.read(&mut request);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\na")
                .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(300));
        });
        let result = super::client()
            .unwrap()
            .get(format!("http://{address}"))
            .timeout(std::time::Duration::from_millis(100))
            .send()
            .await;
        let error = match result {
            Ok(response) => response.bytes().await.unwrap_err(),
            Err(error) => error,
        };
        assert!(error.is_timeout());
        server.join().unwrap();
    }
}
