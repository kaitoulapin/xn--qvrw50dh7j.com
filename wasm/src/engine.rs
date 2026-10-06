use serde_json::{Value, json};
pub fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}
pub fn txt(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
pub fn js_number(s: &str) -> f64 {
    let s = s.trim();
    if s.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(s) = s.strip_prefix(prefix) {
            return u64::from_str_radix(s, radix)
                .map(|n| n as f64)
                .unwrap_or(f64::NAN);
        }
    }
    s.parse().unwrap_or(f64::NAN)
}
pub fn uint32(n: f64) -> u32 {
    if n.is_finite() {
        n.trunc().rem_euclid(4294967296.0) as u32
    } else {
        0
    }
}
fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let Some(pair) = bytes.get(i + 1..i + 3) else {
                return s.into();
            };
            let Ok(pair) = std::str::from_utf8(pair) else {
                return s.into();
            };
            let Ok(byte) = u8::from_str_radix(pair, 16) else {
                return s.into();
            };
            out.push(byte);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| s.into())
}
pub fn param(search: &str, name: &str) -> Option<String> {
    search.trim_start_matches('?').split('&').find_map(|part| {
        let (key, value) = part.split_once('=')?;
        (key == name).then(|| decode(value.split('#').next().unwrap_or("")))
    })
}
pub fn default_state() -> Value {
    json!({"version":2,"totalPulls":0,"pity5":0,"pity4":0,"guaranteeUp":false,"lossStreak":0,"lastStandardUrl":null,"limitedHits":{}})
}
fn load_state(raw: &Value) -> Value {
    let mut state = default_state();
    let saved = if let Some(raw) = raw.as_str() {
        serde_json::from_str(raw).unwrap_or(Value::Null)
    } else {
        raw.clone()
    };
    if num(&saved["version"]) != 2.0 {
        return state;
    }
    for key in ["totalPulls", "pity5", "pity4", "lossStreak"] {
        if let Some(n) = saved[key].as_f64().filter(|n| n.is_finite() && *n >= 0.0) {
            state[key] = json!(n.floor());
        }
    }
    state["guaranteeUp"] = json!(saved["guaranteeUp"] == true);
    if saved["lastStandardUrl"].is_string() {
        state["lastStandardUrl"] = saved["lastStandardUrl"].clone();
    }
    let entries: Vec<(String, Value)> = if let Some(map) = saved["limitedHits"].as_object() {
        map.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    } else if let Some(a) = saved["limitedHits"].as_array() {
        a.iter()
            .enumerate()
            .map(|(i, v)| (i.to_string(), v.clone()))
            .collect()
    } else {
        vec![]
    };
    for (key, v) in entries {
        if let Some(n) = v.as_f64().filter(|n| n.is_finite() && *n >= 0.0) {
            state["limitedHits"][key] = json!(n.floor());
        }
    }
    state
}
pub struct Engine {
    pub config: Value,
    pub state: Value,
    pub rng: u32,
    force: String,
}
impl Engine {
    pub fn new(request: &Value) -> Self {
        let search = txt(&request["search"]);
        let seed = param(search, "seed")
            .map(|v| js_number(&v))
            .filter(|n| n.is_finite());
        Self {
            config: serde_json::from_str(crate::data::config()).unwrap(),
            state: load_state(&request["state"]),
            rng: seed
                .map(uint32)
                .unwrap_or_else(|| uint32(num(&request["entropy"]))),
            force: param(search, "force").unwrap_or_default().to_lowercase(),
        }
    }
    pub fn cfg(&self, key: &str) -> f64 {
        num(&self.config["config"][key])
    }
    fn random(&mut self) -> f64 {
        self.rng = self.rng.wrapping_add(0x6d2b79f5);
        let mut t = self.rng;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
    fn pick(&mut self, cards: &[Value], damping: bool) -> Value {
        let mut weights: Vec<f64> = cards
            .iter()
            .enumerate()
            .map(|(i, card)| {
                let own = card
                    .get("weight")
                    .or_else(|| card.get("share"))
                    .unwrap_or(&Value::Null)
                    .as_f64()
                    .filter(|n| n.is_finite() && *n > 0.0)
                    .unwrap_or(1.0);
                let repeat = if damping && card["url"] == self.state["lastStandardUrl"] {
                    self.cfg("STANDARD_REPEAT_DAMPING")
                } else {
                    1.0
                };
                1.0 / ((i + 1) as f64).powf(self.cfg("WEIGHT_CURVE")) * own * repeat
            })
            .collect();
        let maximum = weights.iter().copied().fold(0.0, f64::max);
        if maximum <= 0.0 {
            weights.fill(1.0);
        } else {
            for weight in &mut weights {
                *weight /= maximum;
            }
        }
        let mut roll = self.random() * weights.iter().sum::<f64>();
        for (i, w) in weights.iter().enumerate() {
            roll -= w;
            if roll < 0.0 {
                return cards[i].clone();
            }
        }
        cards.last().expect("empty pool").clone()
    }
    fn plan(&mut self, name: &str) -> Value {
        let plan = self.config[name].clone();
        let up = plan["up"].as_array().unwrap();
        if !up.is_empty()
            && (plan["cards"].as_array().unwrap().is_empty()
                || self.random() < self.cfg("UP_SHARE"))
        {
            self.pick(up, false)
        } else {
            self.pick(plan["cards"].as_array().unwrap(), false)
        }
    }
    fn rate5(&self) -> f64 {
        let pity = num(&self.state["pity5"]);
        if pity >= self.cfg("HARD_PITY_5") - 1.0 {
            return 1.0;
        }
        if pity < self.cfg("SOFT_PITY_5") - 1.0 {
            return self.cfg("BASE_RATE_5");
        }
        (self.cfg("BASE_RATE_5")
            + (pity - self.cfg("SOFT_PITY_5") + 2.0) * self.cfg("SOFT_PITY_STEP_5"))
        .clamp(0.0, 1.0)
    }
    fn five(&mut self) -> Value {
        let pity = self.state["pity5"].clone();
        let guaranteed = self.state["guaranteeUp"] == true;
        let rate = if num(&self.state["lossStreak"]) >= self.cfg("RADIANCE_LOSSES") {
            self.cfg("RADIANCE_UP_RATE")
        } else {
            self.cfg("UP_RATE")
        };
        let forced_up = self.force == "ur";
        let radiance = !forced_up && !guaranteed && rate > self.cfg("UP_RATE");
        if forced_up || guaranteed || self.random() < rate {
            let mut card = self.plan("limited");
            self.state["guaranteeUp"] = json!(false);
            if !guaranteed || forced_up {
                self.state["lossStreak"] = json!(0);
            }
            let url = txt(&card["url"]).to_owned();
            self.state["limitedHits"][&url] = json!(num(&self.state["limitedHits"][&url]) + 1.0);
            card["pity"] = pity;
            card["guaranteed"] = json!(guaranteed);
            card["radiance"] = json!(radiance);
            card
        } else {
            let cards = self.config["standard"]["cards"].as_array().unwrap().clone();
            let mut card = self.pick(&cards, true);
            self.state["guaranteeUp"] = json!(true);
            self.state["lossStreak"] = json!(num(&self.state["lossStreak"]) + 1.0);
            self.state["lastStandardUrl"] = card["url"].clone();
            card["pity"] = pity;
            card["guaranteed"] = json!(false);
            card["radiance"] = json!(false);
            card["lost"] = json!(true);
            card
        }
    }
    pub fn draw(&mut self) -> Value {
        let rate5 = self.rate5();
        let rate4 = (1.0 - rate5).min(self.cfg("BASE_RATE_4"));
        let roll = self.random();
        let pity = self.state["pity5"].clone();
        let mut card;
        if roll < rate5 || matches!(self.force.as_str(), "ur" | "5") {
            card = self.five();
            self.state["pity5"] = json!(0);
            self.state["pity4"] = json!(0);
        } else if roll < rate5 + rate4 || num(&self.state["pity4"]) >= self.cfg("HARD_PITY_4") - 1.0
        {
            card = self.plan("preferred");
            card["pity"] = pity;
            self.state["pity5"] = json!(num(&self.state["pity5"]) + 1.0);
            self.state["pity4"] = json!(0);
        } else if !self.config["filler"]["up"].as_array().unwrap().is_empty()
            || !self.config["filler"]["cards"]
                .as_array()
                .unwrap()
                .is_empty()
        {
            card = self.plan("filler");
            card["pity"] = pity;
            self.state["pity5"] = json!(num(&self.state["pity5"]) + 1.0);
            self.state["pity4"] = json!(num(&self.state["pity4"]) + 1.0);
        } else if self.random() < self.cfg("FILLER_FALLBACK_UPGRADE") {
            card = self.plan("preferred");
            card["pity"] = pity;
            card["group"] = json!("3★池未配置（提升为4★）");
            self.state["pity5"] = json!(num(&self.state["pity5"]) + 1.0);
            self.state["pity4"] = json!(0);
        } else {
            card = json!({"url":self.config["fallback"],"group":"3★池未配置（兜底）","rarity":"R","pity":pity});
            self.state["pity5"] = json!(num(&self.state["pity5"]) + 1.0);
            self.state["pity4"] = json!(num(&self.state["pity4"]) + 1.0);
        }
        self.state["totalPulls"] = json!(num(&self.state["totalPulls"]) + 1.0);
        card["rate5"] = json!(rate5);
        card
    }
    pub fn many(&mut self, count: usize) -> (Vec<Value>, Value) {
        let cards: Vec<Value> = (0..count).map(|_| self.draw()).collect();
        let mut best = cards[0].clone();
        for card in &cards {
            if rank(txt(&card["rarity"])) > rank(txt(&best["rarity"])) {
                best = card.clone();
            }
        }
        (cards, best)
    }
    pub fn target(&self, card: &Value) -> String {
        let url = txt(&card["url"]);
        if self.config["config"]["PULL_MARK"] != true {
            return url.into();
        }
        let mark = format!(
            "{}-{}",
            txt(&card["rarity"]).to_lowercase(),
            num(&card["pity"])
        );
        if url.starts_with('/')
            || url.starts_with("./")
            || url.starts_with("../")
            || url.starts_with('?')
        {
            let (path, fragment) = url.split_once('#').unwrap_or((url, ""));
            format!(
                "{path}{}gacha={mark}{}",
                if path.contains('?') { '&' } else { '?' },
                if fragment.is_empty() {
                    String::new()
                } else {
                    format!("#{fragment}")
                }
            )
        } else {
            format!("{}#gacha-{mark}", url.split('#').next().unwrap())
        }
    }
    pub fn video(&self, card: &Value) -> Option<String> {
        if card["rarity"] != "UR" {
            return None;
        }
        let v = card
            .get("video")
            .unwrap_or(&self.config["startup"]["DEFAULT_VIDEO"]);
        let v = v.as_str()?.trim();
        if v.is_empty() {
            return None;
        }
        Some(format!(
            "./{}",
            v.strip_prefix("./")
                .or_else(|| v.strip_prefix('/'))
                .unwrap_or(v)
        ))
    }
    pub fn describe(&self, card: &Value) -> Value {
        let mut v = json!({"稀有度":card["rarity"],"分组":card["group"],"地址":card["url"],"距上次5星":card["pity"]});
        if let Some(video) = self.video(card) {
            v["启动动画"] = json!(video);
        }
        if card["rarity"] == "UR" {
            v["限定"] = json!(true);
        }
        for (k, l, m) in [
            ("lost", "歪了", "下个5★必是限定UP"),
            ("guaranteed", "大保底", "本次必为限定UP"),
            ("radiance", "捕获明光", "已触发"),
        ] {
            if card[k] == true {
                v[l] = json!(m);
            }
        }
        v
    }
}
pub fn rank(s: &str) -> u8 {
    match s {
        "UR" => 4,
        "SSR" => 3,
        "SR" => 2,
        _ => 1,
    }
}

#[cfg(test)]
mod audit {
    use super::*;
    fn engine() -> Engine {
        Engine::new(&json!({"search":"?seed=42"}))
    }
    #[test]
    fn soft_and_hard_pity_boundaries() {
        let mut e = engine();
        for (pity, expected) in [
            (0, 0.04),
            (10, 0.04),
            (11, 0.12),
            (12, 0.20),
            (18, 0.68),
            (19, 1.0),
        ] {
            e.state["pity5"] = json!(pity);
            assert!((e.rate5() - expected).abs() < 1e-10);
        }
    }
    #[test]
    fn radiance_is_reachable_through_guarantees() {
        let mut e = engine();
        e.force = "5".into();
        e.config["config"]["UP_RATE"] = json!(0);
        e.config["config"]["RADIANCE_UP_RATE"] = json!(1);
        for expected in [1, 1, 2, 2, 3, 3] {
            e.draw();
            assert_eq!(num(&e.state["lossStreak"]), expected as f64);
        }
        let card = e.draw();
        assert_eq!(card["rarity"], "UR");
        assert_eq!(card["radiance"], true);
        assert_eq!(num(&e.state["lossStreak"]), 0.0);
    }
    #[test]
    fn hard_pities_prevent_excessive_gaps() {
        let mut e = engine();
        e.config["config"]["BASE_RATE_5"] = json!(0);
        e.config["config"]["SOFT_PITY_STEP_5"] = json!(0);
        e.config["config"]["BASE_RATE_4"] = json!(0);
        for _ in 0..1000 {
            e.draw();
            assert!(num(&e.state["pity5"]) < 20.0);
            assert!(num(&e.state["pity4"]) < 10.0);
        }
    }
    #[test]
    fn highest_rarity_wins_multi_pull() {
        let mut e = engine();
        e.force = "5".into();
        let (cards, best) = e.many(50);
        assert!(cards.iter().any(|c| c["rarity"] == "SSR"));
        assert!(cards.iter().any(|c| c["rarity"] == "UR"));
        assert_eq!(best["rarity"], "UR");
        assert_eq!(best, *cards.iter().find(|c| c["rarity"] == "UR").unwrap());
    }
    #[test]
    fn up_only_and_empty_filler_pools_are_safe() {
        let mut e = engine();
        let up = json!({"url":"./up","rarity":"R"});
        e.config["filler"]["cards"] = json!([]);
        e.config["filler"]["up"] = json!([up.clone()]);
        e.config["config"]["UP_SHARE"] = json!(0);
        assert_eq!(e.plan("filler"), up);
        e.config["filler"]["up"] = json!([]);
        e.config["config"]["BASE_RATE_5"] = json!(0);
        e.config["config"]["BASE_RATE_4"] = json!(0);
        e.config["config"]["FILLER_FALLBACK_UPGRADE"] = json!(0);
        assert_eq!(e.draw()["url"], e.config["fallback"]);
    }
    #[test]
    fn weighting_and_repeat_damping_have_expected_distribution() {
        let mut e = engine();
        let cards = vec![json!({"url":"a","weight":4}), json!({"url":"b","weight":1})];
        let hits = (0..20000)
            .filter(|_| e.pick(&cards, false)["url"] == "a")
            .count();
        assert!((0.78..0.82).contains(&(hits as f64 / 20000.0)));
        let cards = vec![json!({"url":"a"}), json!({"url":"b"})];
        e.state["lastStandardUrl"] = json!("a");
        let hits = (0..20000)
            .filter(|_| e.pick(&cards, true)["url"] == "a")
            .count();
        assert!((0.31..0.35).contains(&(hits as f64 / 20000.0)));
    }
    #[test]
    fn share_curve_up_ratio_and_large_weights_work() {
        let mut e = engine();
        for cards in [
            vec![json!({"url":"a","share":4}), json!({"url":"b","share":1})],
            vec![
                json!({"url":"a","weight":1e308}),
                json!({"url":"b","weight":1e308}),
            ],
        ] {
            let hits = (0..20000)
                .filter(|_| e.pick(&cards, false)["url"] == "a")
                .count();
            let expected = if cards[0].get("share").is_some() {
                0.8
            } else {
                0.5
            };
            assert!((hits as f64 / 20000.0 - expected).abs() < 0.02);
        }
        e.config["config"]["WEIGHT_CURVE"] = json!(1);
        let cards = vec![json!({"url":"a"}), json!({"url":"b"}), json!({"url":"c"})];
        let hits = (0..20000)
            .filter(|_| e.pick(&cards, false)["url"] == "a")
            .count();
        assert!((hits as f64 / 20000.0 - 6.0 / 11.0).abs() < 0.02);
        e.config["filler"] = json!({"cards":[{"url":"normal"}],"up":[{"url":"up"}]});
        let hits = (0..20000)
            .filter(|_| e.plan("filler")["url"] == "up")
            .count();
        assert!((hits as f64 / 20000.0 - 0.5).abs() < 0.02);
    }
    #[test]
    fn internal_url_mark_keeps_query_before_fragment() {
        let e = engine();
        assert_eq!(
            e.target(&json!({"url":"./search.html?q=x#anchor","rarity":"SSR","pity":3})),
            "./search.html?q=x&gacha=ssr-3#anchor"
        );
    }
}
