//! 在后端合并客户端实际修改的字段；同一字段冲突时明确拒绝，避免静默丢失设置。
use serde_json::Value;

pub(crate) fn merge(
    latest: &Value,
    base: &Value,
    next: &Value,
    path: &str,
) -> Result<Value, String> {
    if base == next {
        return Ok(latest.clone());
    }
    if latest == base || latest == next {
        return Ok(next.clone());
    }
    if let (Some(current), Some(before), Some(after)) =
        (latest.as_object(), base.as_object(), next.as_object())
    {
        let mut result = current.clone();
        for (key, value) in after {
            let previous = before.get(key).unwrap_or(&Value::Null);
            let current = current.get(key).unwrap_or(&Value::Null);
            result.insert(
                key.clone(),
                merge(current, previous, value, &format!("{path}.{key}"))?,
            );
        }
        return Ok(Value::Object(result));
    }
    if matches!(
        path,
        "config.savedRooms" | "config.savedRoomGroups" | "config.filter.rules"
    ) {
        if let (Some(current), Some(before), Some(after)) =
            (latest.as_array(), base.as_array(), next.as_array())
        {
            let id = |value: &Value| value.get("id").and_then(Value::as_str).map(str::to_owned);
            if current
                .iter()
                .chain(before)
                .chain(after)
                .all(|value| id(value).is_some())
            {
                let mut result = current.clone();
                for old in before {
                    let key = id(old);
                    if !after.iter().any(|item| id(item) == key) {
                        if let Some(value) = result.iter().find(|item| id(item) == key) {
                            if value != old {
                                return Err(conflict(path));
                            }
                        }
                        result.retain(|item| id(item) != key);
                    }
                }
                for desired in after {
                    let key = id(desired);
                    let old = before.iter().find(|item| id(item) == key);
                    let index = result.iter().position(|item| id(item) == key);
                    match (old, index) {
                        (Some(old), Some(index)) => {
                            result[index] = merge(
                                &result[index],
                                old,
                                desired,
                                &format!("{path}[{}]", key.unwrap_or_default()),
                            )?
                        }
                        (Some(old), None) if old == desired => {}
                        (Some(_), None) => return Err(conflict(path)),
                        (None, Some(index)) if &result[index] == desired => {}
                        (None, Some(_)) => return Err(conflict(path)),
                        (None, None) => result.push(desired.clone()),
                    }
                }
                let before_ids: Vec<_> = before.iter().map(id).collect();
                let after_ids: Vec<_> = after.iter().map(id).collect();
                if before_ids != after_ids {
                    // 保留客户端明确指定的顺序，其余窗口新加入的项目放在末尾。
                    result.sort_by_key(|item| {
                        after_ids
                            .iter()
                            .position(|key| *key == id(item))
                            .unwrap_or(usize::MAX)
                    });
                }
                return Ok(Value::Array(result));
            }
        }
    }
    Err(conflict(path))
}

fn conflict(path: &str) -> String {
    format!("设置已在另一个窗口修改（{path}），请重试本次操作")
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    #[test]
    fn independent_fields_and_rooms_are_merged() {
        let base = json!({"appearance":{"theme":"light","fontSize":20},"savedRooms":[{"id":"a","name":"甲"},{"id":"b","name":"乙"}]});
        let mut current = base.clone();
        current["appearance"]["theme"] = json!("dark");
        current["savedRooms"][0]["name"] = json!("新甲");
        let mut next = base.clone();
        next["appearance"]["fontSize"] = json!(30);
        next["savedRooms"][1]["name"] = json!("新乙");
        let merged = super::merge(&current, &base, &next, "config").unwrap();
        assert_eq!(merged["appearance"], json!({"theme":"dark","fontSize":30}));
        assert_eq!(merged["savedRooms"][0]["name"], "新甲");
        assert_eq!(merged["savedRooms"][1]["name"], "新乙");
    }
    #[test]
    fn conflicting_changes_and_delete_edit_conflicts_are_rejected() {
        assert!(super::merge(&json!(2), &json!(1), &json!(3), "config.value").is_err());
        assert!(super::merge(
            &json!([{"id":"a","name":"新"}]),
            &json!([{"id":"a","name":"旧"}]),
            &json!([]),
            "config.savedRooms"
        )
        .is_err());
    }
    #[test]
    fn a_stale_unmodified_room_does_not_resurrect_a_deleted_room() {
        let current = json!([{"id":"b","name":"乙"}]);
        let base = json!([{"id":"a","name":"甲"},{"id":"b","name":"乙"}]);
        let next = json!([{"id":"a","name":"甲"},{"id":"b","name":"新乙"}]);
        assert_eq!(
            super::merge(&current, &base, &next, "config.savedRooms").unwrap(),
            json!([{"id":"b","name":"新乙"}])
        );
    }
}
