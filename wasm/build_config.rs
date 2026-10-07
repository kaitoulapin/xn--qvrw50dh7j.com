use serde_json::{Value, json};
use std::{fs, path::Path};

fn check(ok: bool, path: &str, message: &str) {
    assert!(ok, "{path}: {message}");
}
fn object(v: &Value, path: &str, keys: &[&str]) {
    let o = v.as_object().unwrap_or_else(|| panic!("{path}: must be an object"));
    for key in o.keys() {
        check(keys.contains(&key.as_str()), &format!("{path}.{key}"), "unknown field");
    }
}
fn probability(v: &Value, path: &str) {
    check(v.as_f64().is_some_and(|n| n.is_finite() && (0.0..=1.0).contains(&n)), path, "must be between 0 and 1");
}
fn positive(v: &Value, path: &str) {
    check(v.as_u64().is_some_and(|n| n > 0 && n <= 9007199254740991), path, "must be a positive safe integer");
}
fn nonnegative(v: &Value, path: &str) {
    check(v.as_f64().is_some_and(|n| n.is_finite() && n >= 0.0), path, "must be finite and nonnegative");
}
fn text<'a>(v: &'a Value, path: &str) -> &'a str {
    let s = v.as_str().unwrap_or_else(|| panic!("{path}: must be a string"));
    check(!s.trim().is_empty(), path, "must not be empty");
    s
}
fn url(v: &Value, path: &str) {
    let s = text(v, path);
    check(!s.starts_with("//") && !s.chars().any(|c| c.is_whitespace() || c == '\\') &&
        ["https://", "http://", "/", "./", "../", "?"].iter().any(|p| s.starts_with(p)), path, "unsupported URL");
    if let Some((_, rest)) = s.split_once("://") {
        check(!rest.split(['/', '?', '#']).next().unwrap_or("").is_empty(), path, "missing URL host");
    }
}
pub fn prepare(mut c: Value, pages: &Path) -> Value {
    object(&c, "config", &["schemaVersion", "gacha", "pools", "media", "storage", "redirect"]);
    check(c["schemaVersion"] == 1, "schemaVersion", "unsupported version");
    let g = &c["gacha"];
    object(g, "gacha", &["maxPulls", "weightCurve", "emptyRPoolUpgradeRate", "fiveStar", "fourStar"]);
    positive(&g["maxPulls"], "gacha.maxPulls");
    nonnegative(&g["weightCurve"], "gacha.weightCurve");
    probability(&g["emptyRPoolUpgradeRate"], "gacha.emptyRPoolUpgradeRate");
    let five = &g["fiveStar"];
    object(five, "gacha.fiveStar", &["baseRate", "softPityStart", "softPityStep", "hardPity", "limitedRate", "radiance"]);
    for key in ["baseRate", "softPityStep", "limitedRate"] {
        probability(&five[key], &format!("gacha.fiveStar.{key}"));
    }
    for key in ["softPityStart", "hardPity"] { positive(&five[key], &format!("gacha.fiveStar.{key}")); }
    check(five["softPityStart"].as_u64() <= five["hardPity"].as_u64(), "gacha.fiveStar.softPityStart", "exceeds hard pity");
    let radiance = &five["radiance"];
    object(radiance, "gacha.fiveStar.radiance", &["lossThreshold", "limitedRate"]);
    positive(&radiance["lossThreshold"], "gacha.fiveStar.radiance.lossThreshold");
    probability(&radiance["limitedRate"], "gacha.fiveStar.radiance.limitedRate");
    check(radiance["limitedRate"].as_f64() >= five["limitedRate"].as_f64(), "gacha.fiveStar.radiance.limitedRate", "must not reduce limited rate");
    object(&g["fourStar"], "gacha.fourStar", &["baseRate", "hardPity"]);
    probability(&g["fourStar"]["baseRate"], "gacha.fourStar.baseRate");
    positive(&g["fourStar"]["hardPity"], "gacha.fourStar.hardPity");
    object(&c["storage"], "storage", &["key"]); text(&c["storage"]["key"], "storage.key");
    object(&c["redirect"], "redirect", &["appendPullMark", "fallbackUrl"]);
    check(c["redirect"]["appendPullMark"].is_boolean(), "redirect.appendPullMark", "must be boolean");
    url(&c["redirect"]["fallbackUrl"], "redirect.fallbackUrl");
    let m = &c["media"];
    object(m, "media", &["defaultVideo", "timeoutSeconds", "muted", "skipHint", "showProgress"]);
    check(m.get("defaultVideo").is_some(), "media.defaultVideo", "required (may be null)");
    nonnegative(&m["timeoutSeconds"], "media.timeoutSeconds");
    check(m["skipHint"].is_string(), "media.skipHint", "must be a string");
    for key in ["muted", "showProgress"] { check(m[key].is_boolean(), &format!("media.{key}"), "must be boolean"); }
    let mut videos = vec![("media.defaultVideo".to_owned(), m["defaultVideo"].clone())];
    object(&c["pools"], "pools", &["UR", "SSR", "SR", "R"]);
    for rarity in ["UR", "SSR", "SR", "R"] {
        let pool = &c["pools"][rarity];
        let path = format!("pools.{rarity}");
        object(pool, &path, if rarity == "SSR" { &["cards", "repeatDamping"] } else { &["cards", "featuredCards", "featuredRate"] });
        if rarity == "SSR" { probability(&pool["repeatDamping"], &format!("{path}.repeatDamping")); }
        else { probability(&pool["featuredRate"], &format!("{path}.featuredRate")); }
        let mut count = 0;
        for list in if rarity == "SSR" { vec!["cards"] } else { vec!["cards", "featuredCards"] } {
            let cp = format!("{path}.{list}");
            let cards = pool[list].as_array().unwrap_or_else(|| panic!("{cp}: must be an array"));
            count += cards.len();
            for (i, card) in cards.iter().enumerate() {
                let cp = format!("{cp}[{i}]");
                object(card, &cp, &["url", "title", "weight", "video"]);
                url(&card["url"], &format!("{cp}.url")); text(&card["title"], &format!("{cp}.group"));
                if let Some(w) = card.get("weight") {
                    check(w.as_f64().is_some_and(|n| n.is_finite() && n > 0.0), &format!("{cp}.weight"), "must be finite and positive");
                }
                if let Some(video) = card.get("video") {
                    check(rarity == "UR", &format!("{cp}.video"), "only UR can play video");
                    videos.push((format!("{cp}.video"), video.clone()));
                }
            }
        }
        check(rarity == "R" || count > 0, &path, "must not be empty");
    }
    let base = pages.canonicalize().expect("pages directory missing");
    let mut bytes = json!({});
    for (field, value) in videos {
        if value.is_null() { continue; }
        let path = text(&value, &field);
        check(!path.starts_with('/') && !path.contains(['\\', '?', ':', '#']) &&
            path.split('/').all(|p| !p.is_empty() && p != "." && p != ".."), &field, "invalid video path");
        let file = base.join(path).canonicalize().unwrap_or_else(|_| panic!("{field}: video file missing"));
        check(file.starts_with(&base) && file.is_file(), &field, "video outside pages or not a file");
        println!("cargo:rerun-if-changed={}", file.display());
        bytes[path] = json!(fs::metadata(file).unwrap().len());
    }
    c["media"]["videoBytes"] = bytes;
    c
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> Value { serde_json::from_str(include_str!("config.json")).unwrap() }
    fn pages() -> std::path::PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../pages") }
    #[test]
    fn invalid_fields_and_video_paths_fail_with_paths() {
        for (path, value) in [
            ("/schemaVersion", json!(2)),
            ("/gacha/maxPulls", json!(0)),
            ("/pools/SSR/featuredCards", json!([])),
            ("/pools/UR/cards/0/rarity", json!("UR")),
            ("/pools/UR/cards/0/video", json!("../secret.mp4")),
            ("/pools/UR/cards/0/video", json!("video/missing.mp4")),
            ("/media/showProgress", json!(1)),
            ("/redirect/fallbackUrl", json!("javascript:alert(1)")),
        ] {
            let mut c = source();
            // Object keys may be absent in the canonical source.
            let (parent, key) = path.rsplit_once('/').unwrap();
            c.pointer_mut(parent).unwrap()[key] = value;
            let failure = std::panic::catch_unwind(|| prepare(c, &pages())).unwrap_err();
            let error = failure.downcast_ref::<String>().unwrap();
            assert!(error.contains(path.rsplit('/').next().unwrap()), "{error}");
        }
    }
    #[test]
    fn video_sizes_are_generated_for_each_asset_and_track_changes() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/config-migration/video-fixture");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("first.mp4"), [0u8; 7]).unwrap();
        fs::write(dir.join("second.mp4"), [0u8; 19]).unwrap();
        let mut c = source();
        c["media"]["defaultVideo"] = json!("second.mp4");
        c["pools"]["UR"]["cards"][0]["video"] = json!("first.mp4");
        let prepared = prepare(c.clone(), &dir);
        assert_eq!(prepared["media"]["videoBytes"]["first.mp4"], 7);
        assert_eq!(prepared["media"]["videoBytes"]["second.mp4"], 19);
        fs::write(dir.join("first.mp4"), [0u8; 31]).unwrap();
        assert_eq!(prepare(c, &dir)["media"]["videoBytes"]["first.mp4"], 31);
    }
}
