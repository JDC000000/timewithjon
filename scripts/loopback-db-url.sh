#!/usr/bin/env bash
# scripts/loopback-db-url.sh — sourced by scripts/test-route.sh (pr70-review F1). is_loopback_db_url URL succeeds
# only for postgres[ql]://user[:pass]@127.0.0.1|localhost:PORT/DBNAME with nothing after the database name: no
# query string or fragment (pg-connection-string lets ?host= override the host), and an explicit port.
is_loopback_db_url() {
  [[ "$1" =~ ^postgres(ql)?://[^@/?#]*@(127\.0\.0\.1|localhost):[0-9]+/[A-Za-z0-9_-]+$ ]]
}
