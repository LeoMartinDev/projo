//! `mpv_node` → `serde_json::Value`. Pure (no libmpv call), so it is tested on hand-built nodes.

use std::ffi::{c_char, CStr};

use serde_json::{Map, Number, Value};

use super::ffi::{
    MpvNode, MPV_FORMAT_BYTE_ARRAY, MPV_FORMAT_DOUBLE, MPV_FORMAT_FLAG, MPV_FORMAT_INT64,
    MPV_FORMAT_NODE_ARRAY, MPV_FORMAT_NODE_MAP, MPV_FORMAT_NONE, MPV_FORMAT_OSD_STRING,
    MPV_FORMAT_STRING,
};

/// Converts a node. `None` = no value (MPV_FORMAT_NONE, a non-finite double, an unknown format):
/// the IPC payload then leaves `value` out. Inside an array such a value becomes JSON `null` (the
/// positions must stay); inside a map the key is left out.
///
/// # Safety
/// `node` must be a valid node as produced by libmpv (or built the same way): strings NUL-terminated,
/// lists holding `num` values (and `num` keys for a map).
pub unsafe fn node_to_json(node: &MpvNode) -> Option<Value> {
    match node.format {
        MPV_FORMAT_NONE => None,
        MPV_FORMAT_STRING | MPV_FORMAT_OSD_STRING => {
            Some(Value::String(c_string(node.u.string).unwrap_or_default()))
        }
        MPV_FORMAT_FLAG => Some(Value::Bool(node.u.flag != 0)),
        MPV_FORMAT_INT64 => Some(Value::Number(Number::from(node.u.int64))),
        MPV_FORMAT_DOUBLE => Number::from_f64(node.u.double).map(Value::Number),
        MPV_FORMAT_NODE_ARRAY => {
            let list = node.u.list;
            if list.is_null() {
                return Some(Value::Array(Vec::new()));
            }
            let list = &*list;
            Some(Value::Array(
                children(list.values, list.num)
                    .iter()
                    .map(|child| node_to_json(child).unwrap_or(Value::Null))
                    .collect(),
            ))
        }
        MPV_FORMAT_NODE_MAP => {
            let list = node.u.list;
            let mut map = Map::new();
            if list.is_null() {
                return Some(Value::Object(map));
            }
            let list = &*list;
            let values = children(list.values, list.num);
            let keys: &[*mut c_char] = if list.keys.is_null() || values.is_empty() {
                &[]
            } else {
                std::slice::from_raw_parts(list.keys, values.len())
            };
            for (key, child) in keys.iter().zip(values) {
                if let (Some(key), Some(value)) = (c_string(*key), node_to_json(child)) {
                    map.insert(key, value);
                }
            }
            Some(Value::Object(map))
        }
        MPV_FORMAT_BYTE_ARRAY => {
            let array = node.u.ba;
            if array.is_null() || (*array).data.is_null() {
                return Some(Value::Array(Vec::new()));
            }
            let bytes = std::slice::from_raw_parts((*array).data as *const u8, (*array).size);
            Some(Value::Array(
                bytes.iter().map(|byte| Value::from(*byte)).collect(),
            ))
        }
        _ => None,
    }
}

unsafe fn children<'a>(values: *mut MpvNode, num: i32) -> &'a [MpvNode] {
    if values.is_null() || num <= 0 {
        return &[];
    }
    std::slice::from_raw_parts(values, num as usize)
}

/// A NUL-terminated C string as UTF-8 (lossy: mpv may hand out file names in other encodings).
///
/// # Safety
/// `pointer` is NULL or points to a NUL-terminated string.
pub unsafe fn c_string(pointer: *const c_char) -> Option<String> {
    if pointer.is_null() {
        return None;
    }
    Some(CStr::from_ptr(pointer).to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mpv::ffi::{MpvByteArray, MpvNodeList, MpvNodeValue};
    use serde_json::json;
    use std::ffi::{c_void, CString};

    // Hand-built nodes own their storage in these vectors, kept alive for the test's duration.
    struct Arena {
        // Boxed: nodes point at the lists, which must not move when the vector grows.
        #[allow(clippy::vec_box)]
        lists: Vec<Box<MpvNodeList>>,
        strings: Vec<CString>,
        nodes: Vec<Vec<MpvNode>>,
        keys: Vec<Vec<*mut c_char>>,
    }

    impl Arena {
        fn new() -> Arena {
            Arena {
                strings: Vec::new(),
                lists: Vec::new(),
                nodes: Vec::new(),
                keys: Vec::new(),
            }
        }
        fn string(&mut self, value: &str) -> MpvNode {
            let owned = CString::new(value).expect("test string without NUL");
            let pointer = owned.as_ptr() as *mut c_char;
            self.strings.push(owned);
            MpvNode {
                u: MpvNodeValue { string: pointer },
                format: MPV_FORMAT_STRING,
            }
        }
        fn list(&mut self, format: i32, entries: Vec<(Option<&str>, MpvNode)>) -> MpvNode {
            let mut keys = Vec::new();
            let mut values = Vec::new();
            for (key, value) in entries {
                if let Some(key) = key {
                    let owned = CString::new(key).expect("test key without NUL");
                    keys.push(owned.as_ptr() as *mut c_char);
                    self.strings.push(owned);
                }
                values.push(value);
            }
            let mut list = Box::new(MpvNodeList {
                num: values.len() as i32,
                values: values.as_mut_ptr(),
                keys: if format == MPV_FORMAT_NODE_MAP {
                    keys.as_mut_ptr()
                } else {
                    std::ptr::null_mut()
                },
            });
            let pointer = &mut *list as *mut MpvNodeList;
            self.nodes.push(values);
            self.keys.push(keys);
            self.lists.push(list);
            MpvNode {
                u: MpvNodeValue { list: pointer },
                format,
            }
        }
    }

    fn flag(value: bool) -> MpvNode {
        MpvNode {
            u: MpvNodeValue { flag: value as i32 },
            format: MPV_FORMAT_FLAG,
        }
    }
    fn int(value: i64) -> MpvNode {
        MpvNode {
            u: MpvNodeValue { int64: value },
            format: MPV_FORMAT_INT64,
        }
    }
    fn double(value: f64) -> MpvNode {
        MpvNode {
            u: MpvNodeValue { double: value },
            format: MPV_FORMAT_DOUBLE,
        }
    }
    fn none() -> MpvNode {
        MpvNode {
            u: MpvNodeValue { int64: 0 },
            format: MPV_FORMAT_NONE,
        }
    }

    #[test]
    fn converts_scalars() {
        let mut arena = Arena::new();
        unsafe {
            assert_eq!(node_to_json(&flag(true)), Some(json!(true)));
            assert_eq!(node_to_json(&flag(false)), Some(json!(false)));
            assert_eq!(node_to_json(&int(-42)), Some(json!(-42)));
            assert_eq!(node_to_json(&double(12.5)), Some(json!(12.5)));
            assert_eq!(
                node_to_json(&arena.string("gpu-next")),
                Some(json!("gpu-next"))
            );
            assert_eq!(
                node_to_json(&arena.string("Élodie — 日本語")),
                Some(json!("Élodie — 日本語"))
            );
        }
    }

    #[test]
    fn leaves_out_missing_and_non_finite_values() {
        unsafe {
            assert_eq!(node_to_json(&none()), None);
            assert_eq!(node_to_json(&double(f64::NAN)), None);
            assert_eq!(node_to_json(&double(f64::INFINITY)), None);
            assert_eq!(
                node_to_json(&MpvNode {
                    u: MpvNodeValue { int64: 0 },
                    format: 99
                }),
                None
            );
        }
    }

    #[test]
    fn converts_a_track_list() {
        let mut arena = Arena::new();
        let video = {
            let kind = arena.string("video");
            let codec = arena.string("hevc");
            arena.list(
                MPV_FORMAT_NODE_MAP,
                vec![
                    (Some("id"), int(1)),
                    (Some("type"), kind),
                    (Some("selected"), flag(true)),
                    (Some("codec"), codec),
                    (Some("demux-fps"), double(23.976)),
                    (Some("ff-index"), int(0)),
                    (Some("lang"), none()),
                ],
            )
        };
        let subtitle = {
            let kind = arena.string("sub");
            let codec = arena.string("hdmv_pgs_subtitle");
            let lang = arena.string("fre");
            arena.list(
                MPV_FORMAT_NODE_MAP,
                vec![
                    (Some("id"), int(3)),
                    (Some("type"), kind),
                    (Some("selected"), flag(false)),
                    (Some("codec"), codec),
                    (Some("lang"), lang),
                    (Some("ff-index"), int(4)),
                ],
            )
        };
        let tracks = arena.list(MPV_FORMAT_NODE_ARRAY, vec![(None, video), (None, subtitle)]);
        assert_eq!(
            unsafe { node_to_json(&tracks) },
            Some(json!([
                { "id": 1, "type": "video", "selected": true, "codec": "hevc", "demux-fps": 23.976, "ff-index": 0 },
                { "id": 3, "type": "sub", "selected": false, "codec": "hdmv_pgs_subtitle", "lang": "fre", "ff-index": 4 },
            ])),
        );
    }

    #[test]
    fn keeps_array_positions_and_empty_lists() {
        let mut arena = Arena::new();
        let array = arena.list(
            MPV_FORMAT_NODE_ARRAY,
            vec![(None, int(1)), (None, none()), (None, flag(true))],
        );
        let empty_map = arena.list(MPV_FORMAT_NODE_MAP, vec![]);
        let empty_array = arena.list(MPV_FORMAT_NODE_ARRAY, vec![]);
        let null_list = MpvNode {
            u: MpvNodeValue {
                list: std::ptr::null_mut(),
            },
            format: MPV_FORMAT_NODE_MAP,
        };
        unsafe {
            assert_eq!(
                node_to_json(&array),
                Some(json!([1, serde_json::Value::Null, true]))
            );
            assert_eq!(node_to_json(&empty_map), Some(json!({})));
            assert_eq!(node_to_json(&empty_array), Some(json!([])));
            assert_eq!(node_to_json(&null_list), Some(json!({})));
        }
    }

    #[test]
    fn converts_byte_arrays_and_null_strings() {
        let mut bytes = vec![0u8, 127, 255];
        let mut array = MpvByteArray {
            data: bytes.as_mut_ptr() as *mut c_void,
            size: bytes.len(),
        };
        let node = MpvNode {
            u: MpvNodeValue { ba: &mut array },
            format: MPV_FORMAT_BYTE_ARRAY,
        };
        let null_string = MpvNode {
            u: MpvNodeValue {
                string: std::ptr::null_mut(),
            },
            format: MPV_FORMAT_STRING,
        };
        unsafe {
            assert_eq!(node_to_json(&node), Some(json!([0, 127, 255])));
            assert_eq!(node_to_json(&null_string), Some(json!("")));
        }
    }
}
