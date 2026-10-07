use crate::engine::*;
use serde_json::{Value, json};
use std::cell::RefCell;
fn fixed(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n.is_infinite() {
        if n.is_sign_negative() {
            "-Infinity".into()
        } else {
            "Infinity".into()
        }
    } else {
        format!("{n:.2}")
    }
}
fn log(message: &str, data: Value) -> Value {
    json!({"op":"log","message":message,"data":data})
}
struct Session {
    destination: String,
    video: String,
    startup: Value,
    progress: Value,
    started: bool,
    finished: bool,
    resolved: bool,
    blocked: bool,
    timer: bool,
}
impl Session {
    fn finish(&mut self) -> Vec<Value> {
        if self.finished {
            return vec![];
        }
        self.finished = true;
        vec![
            json!({"op":"cleanup"}),
            json!({"op":"redirect","url":self.destination}),
        ]
    }
    fn block(&mut self) -> Vec<Value> {
        if self.resolved || self.startup["muted"] == true {
            return vec![];
        }
        self.resolved = true;
        self.blocked = true;
        vec![
            json!({"op":"hint","text":format!("{}{}", "🔇 点击任意处开声音　·　",txt(&self.startup["skipHint"]))}),
            log(
                "[启动动画] 带声音播放被拦下，先静音播放；点击任意处开启声音",
                Value::Null,
            ),
        ]
    }
    fn event(&mut self, event: &str, request: &Value) -> Vec<Value> {
        if self.finished {
            return vec![];
        }
        let timeout = num(&self.startup["timeoutSeconds"]);
        let muted = self.startup["muted"] == true;
        match event {
            "start" if !self.started => {
                self.started = true;
                vec![
                    json!({"op":"guide_status"}),
                    json!({"op":"video","url":self.video,"muted":muted,"hint":self.startup["skipHint"],"progress":self.progress}),
                    json!({"op":"timer","id":"load","ms":if timeout>0.0 {(timeout+5.0)*1000.0} else {30000.0}}),
                    log(
                        "[启动动画] 开始播放",
                        json!({"video":self.video,"muted":muted}),
                    ),
                    json!({"op":"play","kind":"initial"}),
                ]
            }
            "start" => vec![],
            "skip" | "ended" | "error" | "timeout" => self.finish(),
            "playing" => {
                let mut c = vec![json!({"op":"drop_loader"})];
                if !self.timer && timeout > 0.0 {
                    self.timer = true;
                    c.push(json!({"op":"timer","id":"play","ms":timeout*1000.0}));
                }
                c
            }
            "progress" => {
                vec![json!({"op":"progress","percent":num(&request["percent"]).clamp(0.0,100.0)})]
            }
            "interact" if !muted && (!self.resolved || self.blocked) => {
                self.resolved = true;
                self.blocked = false;
                vec![
                    json!({"op":"sound","muted":false,"restart":true}),
                    json!({"op":"hint","text":self.startup["skipHint"]}),
                    json!({"op":"play","kind":"unlock"}),
                    log("[启动动画] 用户交互，已开启声音并从头重播", Value::Null),
                ]
            }
            "play_error"
                if request["kind"] == "initial" && request["name"] == "NotAllowedError" =>
            {
                let mut c = self.block();
                c.push(json!({"op":"sound","muted":true}));
                c.push(json!({"op":"play","kind":"retry"}));
                c
            }
            "volumechange" if request["muted"] == true && !self.resolved => self.block(),
            "play_error" => vec![log(
                "[启动动画] 播放失败，等待兜底跳转",
                request["name"].clone(),
            )],
            _ => vec![],
        }
    }
}
thread_local! {static SESSION:RefCell<Option<Session>>=const {RefCell::new(None)};}
pub fn execute(request: &Value) -> Value {
    let event = txt(&request["event"]);
    if event == "metadata" {
        let config: Value = serde_json::from_str(crate::data::config()).unwrap();
        return json!({"storageKey":config["storage"]["key"]});
    }
    if event != "init" && event != "compare" {
        return SESSION.with(|s|json!({"commands":s.borrow_mut().as_mut().map(|s|s.event(event,request)).unwrap_or_default()}));
    }
    // 暂停直播优先跳转；恢复时取消此段注释，并恢复 load.js 的状态请求。
    /*
    if event == "init" {
        let search = txt(&request["search"]);
        let diagnostic = param(search, "probe").is_some_and(|v| v != "0" && v != "false");
        let status = &request["liveStatus"];
        let now = request["now"].as_u64();
        let checked = status["checkedAt"].as_u64();
        let expires = status["expiresAt"].as_u64();
        if !diagnostic && status["schemaVersion"] == 1 && status["roomId"] == 42062
            && status["liveStatus"] == 1
            && matches!((now, checked, expires), (Some(n), Some(c), Some(e))
                if c <= n && n < e && e > c && e - c <= 600000)
        {
            SESSION.with(|s| *s.borrow_mut() = None);
            return json!({"commands":[{"op":"redirect","url":"https://live.bilibili.com/42062"}]});
        }
    }
    */
    let mut engine = Engine::new(request);
    if event == "compare" {
        let count = num(&request["count"]).clamp(1.0, 200000.0) as usize;
        let (cards, best) = engine.many(count);
        return json!({"cards":cards,"best":best,"state":engine.state,"rng":engine.rng,"target":engine.target(&best),"video":engine.video(&best)});
    }
    SESSION.with(|s| *s.borrow_mut() = None);
    let search = txt(&request["search"]);
    let key = engine.config["storage"]["key"].clone();
    let mut commands = vec![];
    if matches!(param(search, "reset").as_deref(), Some("1" | "true")) {
        engine.state = default_state();
        commands.push(json!({"op":"remove_storage","key":key}));
        if param(search, "probe").is_some() {
            commands.push(log("[卡池] 保底进度已重置", Value::Null));
        }
    }
    let probe = param(search, "probe");
    if probe.as_ref().is_some_and(|v| v != "0" && v != "false") {
        let sim = param(search, "sim").map(|v| js_number(&v)).unwrap_or(0.0);
        if sim.is_finite() && sim > 0.0 {
            let snapshot = engine.state.clone();
            let count = sim.floor().clamp(1.0, 200000.0) as usize;
            let mut stats = json!({"五星":0,"四星":0,"三星":0,"限定UP":0,"常驻歪":0,"最长连续三星":0,"最长未出五星":0});
            let mut since5 = 0;
            let mut since4 = 0;
            let mut first5: Option<usize> = None;
            for i in 0..count {
                let card = engine.draw();
                since5 += 1;
                if matches!(txt(&card["rarity"]), "UR" | "SSR") {
                    stats["五星"] = json!(num(&stats["五星"]) + 1.0);
                    if first5.is_none() {
                        first5 = Some(i + 1);
                    }
                    let label = if card["rarity"] == "UR" {
                        "限定UP"
                    } else {
                        "常驻歪"
                    };
                    stats[label] = json!(num(&stats[label]) + 1.0);
                    stats["最长未出五星"] =
                        json!(num(&stats["最长未出五星"]).max((since5 - 1) as f64));
                    since5 = 0;
                }
                if card["rarity"] == "SR" {
                    stats["四星"] = json!(num(&stats["四星"]) + 1.0);
                }
                if card["rarity"] == "R" {
                    since4 += 1;
                    stats["最长连续三星"] = json!(num(&stats["最长连续三星"]).max(since4 as f64));
                } else {
                    since4 = 0;
                }
                if card["rarity"] == "R" {
                    stats["三星"] = json!(num(&stats["三星"]) + 1.0);
                }
            }
            stats["最长未出五星"] = json!(num(&stats["最长未出五星"]).max(since5 as f64));
            let pct = |n: f64| format!("{:.2}%", n / count as f64 * 100.0);
            let result = json!({"五星数":stats["五星"],"四星数":stats["四星"],"三星数":stats["三星"],"五星占比":pct(num(&stats["五星"])),"四星占比":pct(num(&stats["四星"])),"三星占比":pct(num(&stats["三星"])),"限定UP占比":pct(num(&stats["限定UP"])),"常驻歪占比":pct(num(&stats["常驻歪"])),"平均几抽一个五星":fixed(count as f64 / num(&stats["五星"])),"首次五星出现在第几抽":first5,"最长连续三星":stats["最长连续三星"],"最长连续未出五星":stats["最长未出五星"],"限定链接出货":engine.state["limitedHits"]});
            commands.push(log(
                &format!("{}{}{}", "[卡池] 模拟结果（", count, " 抽，不写入真实进度）"),
                result,
            ));
            engine.state = snapshot;
        } else {
            let card = engine.draw();
            commands.push(log("[卡池] 本次抽卡",json!({"card":engine.describe(&card),"5★出率":format!("{:.1}%",num(&card["rate5"])*100.0)})));
            commands.push(log("[卡池] 抽卡进度",json!({"总抽数":engine.state["totalPulls"],"距上次5星":engine.state["pity5"],"距上次4星":engine.state["pity4"],"大保底":engine.state["guaranteeUp"],"连续歪":engine.state["lossStreak"]})));
            commands.push(log("[卡池] 跳转目标", json!(engine.target(&card))));
            if request["storageBroken"] == true {
                commands.push(log(
                    "[卡池] localStorage 不可用，当前为无状态模式（保底不跨访问）",
                    Value::Null,
                ));
            }
        }
    } else {
        let pull = param(search, "pull").map(|v| js_number(&v)).unwrap_or(1.0);
        let count = if pull.is_finite() && pull > 1.0 {
            pull.floor().min(num(&engine.config["gacha"]["maxPulls"])) as usize
        } else {
            1
        };
        let (cards, best) = engine.many(count);
        commands.push(json!({"op":"save","key":key,"state":engine.state}));
        if count > 1 {
            commands.push(log(
                &format!("{}{}{}", "[卡池] ", count, " 连"),
                json!(cards.iter().map(|c| engine.describe(c)).collect::<Vec<_>>()),
            ));
        }
        let destination = engine.target(&best);
        if let Some(video) = engine.video(&best) {
            commands.push(json!({"op":"guide","html":crate::data::guide()}));
            SESSION.with(|s| {
                *s.borrow_mut() = Some(Session {
                    destination,
                    video,
                    startup: engine.config["media"].clone(),
                    progress: engine.progress(&best),
                    started: false,
                    finished: false,
                    resolved: false,
                    blocked: false,
                    timer: false,
                })
            });
        } else {
            commands.push(json!({"op":"redirect","url":destination}));
        }
    }
    json!({"commands":commands,"state":engine.state,"rng":engine.rng})
}
