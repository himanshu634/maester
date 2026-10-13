/**
 * The API's connection shapes. apps/web is a standalone project and cannot import
 * @maester/contracts, so these mirror packages/contracts/src/connection.ts (ConnectionProvider,
 * Connection, ConnectionList, SaveDhanConnectionRequest, SaveFredConnectionRequest). When the
 * contract changes, change it here too. The key itself is never sent back: only its last 4.
 */

export type ConnectionProvider = 'dhan' | 'fred';

export interface Connection {
	provider: ConnectionProvider;
	state: 'not_connected' | 'connected' | 'expired' | 'failing';
	clientId: string | null;
	last4: string | null;
	expiresAt: string | null;
	checkedAt: string | null;
	/** When readings from this source were last stored. */
	lastRead: string | null;
	/** Dhan took the token but the Data API subscription is off. */
	notice: 'DATA_PLAN_INACTIVE' | null;
}

/** Always two items, Dhan first. */
export interface ConnectionList {
	items: Connection[];
}

export interface SaveDhanConnectionRequest {
	clientId: string;
	accessToken: string;
}

export interface SaveFredConnectionRequest {
	apiKey: string;
}
