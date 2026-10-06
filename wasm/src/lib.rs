mod data;
#[allow(unused_parens)]
mod engine {
    include!(concat!(env!("OUT_DIR"), "/engine.rs"));
}
#[allow(unused_parens)]
mod runtime {
    include!(concat!(env!("OUT_DIR"), "/runtime.rs"));
}
pub use runtime::execute;
use serde_json::{Value, json};
use std::cell::RefCell;

// Input is caller-owned; output remains valid until the next dispatch.
thread_local! { static OUTPUT:RefCell<Vec<u8>>=const {RefCell::new(Vec::new())}; }
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    unsafe {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dispatch(ptr: *const u8, len: usize) -> *const u8 {
    let input = unsafe { std::slice::from_raw_parts(ptr, len) };
    let response = match serde_json::from_slice::<Value>(input) {
        Ok(request) => execute(&request),
        Err(_) => json!({"error":true}),
    };
    OUTPUT.with(|out| {
        let mut out = out.borrow_mut();
        *out = serde_json::to_vec(&response).unwrap();
        out.as_ptr()
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn output_len() -> usize {
    OUTPUT.with(|out| out.borrow().len())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reproducible_seed() {
        let r = json!({"event":"compare","search":"?seed=42","count":1000});
        let a = execute(&r);
        assert_eq!(a, execute(&r));
        assert_eq!(engine::num(&a["state"]["totalPulls"]), 1000.0);
    }
    #[test]
    fn guide_then_play_once() {
        let result = execute(&json!({"event":"init","search":"?seed=42&force=ur"}));
        assert!(
            result["commands"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["op"] == "guide")
        );
        let start = execute(&json!({"event":"start"}));
        assert!(
            start["commands"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["op"] == "play")
        );
        assert_eq!(execute(&json!({"event":"start"}))["commands"], json!([]));
        assert_eq!(
            execute(&json!({"event":"ended"}))["commands"][1]["op"],
            "redirect"
        );
        assert_eq!(execute(&json!({"event":"ended"}))["commands"], json!([]));
    }
}
