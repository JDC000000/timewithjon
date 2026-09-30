-- T3.3.05 (lane L5): Disconnect forgets the refresh token but keeps the row, so calendar_id survives and a
-- reconnect reuses "Time with Jon" instead of creating a second calendar (T3.3 AC4). A null token = disconnected.
alter table oauth_connection alter column refresh_token_enc drop not null;
