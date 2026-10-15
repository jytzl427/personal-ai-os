pub struct EmbeddedResource {
    pub relative_path: &'static str,
    pub bytes: &'static [u8],
}

pub const VERSION: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/runtime-version.txt"));

pub const ALL: &[EmbeddedResource] = &[
    EmbeddedResource { relative_path: "runtime-version.txt", bytes: VERSION },
    EmbeddedResource { relative_path: "node.exe", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/node.exe")) },
    EmbeddedResource { relative_path: "paios-server/server.mjs", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/server.mjs")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/package.json", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/package.json")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/build/Release/better_sqlite3.node", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/build/Release/better_sqlite3.node")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/database.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/database.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/index.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/index.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/sqlite-error.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/sqlite-error.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/util.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/util.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/methods/aggregate.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/methods/aggregate.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/methods/backup.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/methods/backup.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/methods/function.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/methods/function.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/methods/inspect.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/methods/inspect.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/methods/pragma.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/methods/pragma.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/methods/serialize.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/methods/serialize.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/methods/table.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/methods/table.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/methods/transaction.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/methods/transaction.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/better-sqlite3/lib/methods/wrappers.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/better-sqlite3/lib/methods/wrappers.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/bindings/bindings.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/bindings/bindings.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/bindings/package.json", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/bindings/package.json")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/file-uri-to-path/index.js", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/file-uri-to-path/index.js")) },
    EmbeddedResource { relative_path: "paios-server/node_modules/file-uri-to-path/package.json", bytes: include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/resources/paios-server/node_modules/file-uri-to-path/package.json")) },
];
