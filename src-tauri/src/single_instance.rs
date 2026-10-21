//! 单实例：与 C# 版 App.xaml.cs 的「命名互斥体 + 命名事件」方案对齐。
//!
//! 首实例创建命名互斥体与命名事件；后启动的实例把事件置位来唤醒首实例，然后自己退出。
//! 后缀由 exe 文件名决定（见 instance_id）：正式版 LiveBell.exe 后缀为空，
//! 测试版换个别名（LiveBell-Test.exe）就有一把自己的锁，两个版本可以同时跑。

const MUTEX_NAME_PREFIX: &str = r"Local\LiveBell.SingleInstance";
const WAKE_EVENT_NAME_PREFIX: &str = r"Local\LiveBell.Wake";
const WAKE_POLL_INTERVAL_MS: u32 = 500;

/// 单实例守卫：首实例持有它；非首实例拿到 is_primary() == false 后应立即退出。
pub struct InstanceGuard {
    is_primary: bool,
    wake_event: Option<isize>,
}

impl InstanceGuard {
    /// 不抢锁的守卫：设置 LIVEBELL_NO_SINGLE_INSTANCE=1 时用它（调试/排查启动问题用，
    /// 这样不用先关掉正在运行的正式版就能附加调试器）。
    pub fn primary_unlocked() -> Self {
        Self {
            is_primary: true,
            wake_event: None,
        }
    }

    pub fn acquire(suffix: &str) -> Self {
        #[cfg(windows)]
        {
            match platform::acquire(suffix) {
                Ok((is_primary, wake_event)) => Self {
                    is_primary,
                    wake_event,
                },
                Err(error) => {
                    tracing::warn!(
                        target: "livebell::app",
                        error = %error,
                        "single instance check failed, continuing as primary"
                    );
                    Self {
                        is_primary: true,
                        wake_event: None,
                    }
                }
            }
        }
        #[cfg(not(windows))]
        {
            let _ = suffix;
            Self {
                is_primary: true,
                wake_event: None,
            }
        }
    }

    pub fn is_primary(&self) -> bool {
        self.is_primary
    }

    /// 取走唤醒事件句柄（只能取一次）；交给 listen 起监听线程。
    pub fn take_wake_event(&mut self) -> Option<isize> {
        self.wake_event.take()
    }
}

/// 在独立线程里等唤醒事件；被置位时调用 handler。
pub fn listen(event: isize, handler: impl Fn() + Send + 'static) {
    #[cfg(windows)]
    {
        platform::listen(event, handler);
    }
    #[cfg(not(windows))]
    {
        let _ = (event, handler);
    }
}

#[cfg(windows)]
mod platform {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, WAIT_OBJECT_0,
    };
    use windows::Win32::System::Threading::{
        CreateEventW, CreateMutexW, OpenEventW, SetEvent, WaitForSingleObject, EVENT_MODIFY_STATE,
    };

    use super::{MUTEX_NAME_PREFIX, WAKE_EVENT_NAME_PREFIX, WAKE_POLL_INTERVAL_MS};

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 返回 (是否首实例, 唤醒事件句柄)。
    pub fn acquire(suffix: &str) -> Result<(bool, Option<isize>), String> {
        let mutex_name = wide(&format!("{MUTEX_NAME_PREFIX}{suffix}"));
        let wake_name = wide(&format!("{WAKE_EVENT_NAME_PREFIX}{suffix}"));

        // 句柄要活到进程退出，交给系统在进程结束时回收，这里故意不 CloseHandle。
        let mutex = unsafe { CreateMutexW(None, true.into(), PCWSTR(mutex_name.as_ptr())) }
            .map_err(|error| format!("创建单实例互斥体失败：{error}"))?;

        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            // 只需要置位事件，不等待它，所以申请 EVENT_MODIFY_STATE 即可。
            if let Ok(event) = unsafe {
                OpenEventW(EVENT_MODIFY_STATE, false, PCWSTR(wake_name.as_ptr()))
            } {
                let _ = unsafe { SetEvent(event) };
                let _ = unsafe { CloseHandle(event) };
            }
            let _ = unsafe { CloseHandle(mutex) };
            return Ok((false, None));
        }

        let event = unsafe { CreateEventW(None, false, false, PCWSTR(wake_name.as_ptr())) }
            .map_err(|error| format!("创建单实例唤醒事件失败：{error}"))?;

        Ok((true, Some(event.0 as isize)))
    }

    pub fn listen(event: isize, handler: impl Fn() + Send + 'static) {
        std::thread::spawn(move || {
            let handle = HANDLE(event as *mut core::ffi::c_void);
            loop {
                if unsafe { WaitForSingleObject(handle, WAKE_POLL_INTERVAL_MS) } == WAIT_OBJECT_0 {
                    handler();
                }
            }
        });
    }
}
