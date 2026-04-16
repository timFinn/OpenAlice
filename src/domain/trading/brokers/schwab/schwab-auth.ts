/**
 * Schwab OAuth 2.0 Token Manager
 *
 * Handles the full OAuth lifecycle for the Schwab Trader API:
 *   1. Authorization URL generation (browser redirect)
 *   2. Authorization code → token exchange
 *   3. Automatic access token refresh (30min expiry)
 *   4. Refresh token rotation (7-day expiry)
 *   5. Token persistence to disk
 *
 * Token flow:
 *   User visits authUrl → Schwab redirects to callbackUrl with ?code=xxx
 *   → exchangeCode(code) → tokens stored → auto-refresh on getAccessToken()
 *
 * This module is broker-agnostic enough to be reused for Tradier or other
 * OAuth 2.0 brokers with minor config changes.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SchwabTokenResponse, SchwabTokenState } from './schwab-types.js'

// ==================== Constants ====================

const AUTH_BASE = 'https://api.schwabapi.com/v1/oauth'
const TOKEN_URL = `${AUTH_BASE}/token`
const AUTHORIZE_URL = `${AUTH_BASE}/authorize`

/** Refresh 2 minutes before actual expiry to avoid race conditions. */
const REFRESH_BUFFER_MS = 2 * 60 * 1000

/** Refresh tokens expire after 7 days. */
const REFRESH_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

// ==================== Token Manager ====================

export interface SchwabAuthConfig {
  appKey: string
  appSecret: string
  callbackUrl: string
  /** Path to persist tokens (e.g. data/schwab/tokens.json). */
  tokenFile: string
}

export class SchwabTokenManager {
  private state: SchwabTokenState | null = null
  private refreshPromise: Promise<void> | null = null
  private readonly config: SchwabAuthConfig

  constructor(config: SchwabAuthConfig) {
    this.config = config
  }

  // ---- Public API ----

  /**
   * Generate the authorization URL for the initial OAuth flow.
   * The user must visit this URL in a browser, authorize, and
   * provide the resulting callback URL (or auth code) back.
   */
  getAuthorizationUrl(): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.appKey,
      redirect_uri: this.config.callbackUrl,
    })
    return `${AUTHORIZE_URL}?${params.toString()}`
  }

  /**
   * Exchange an authorization code for access + refresh tokens.
   * Call this once after the user completes the browser OAuth flow.
   */
  async exchangeCode(code: string): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.callbackUrl,
    })

    const response = await this.tokenRequest(body)
    this.state = this.responseToState(response)
    await this.persist()
  }

  /**
   * Get a valid access token, refreshing if needed.
   * Throws if no tokens are available (user must authorize first).
   */
  async getAccessToken(): Promise<string> {
    if (!this.state) {
      await this.loadFromDisk()
    }
    if (!this.state) {
      throw new Error(
        'No Schwab tokens available. Complete the OAuth authorization flow first: ' +
        this.getAuthorizationUrl()
      )
    }

    // Check if refresh token itself has expired (7 days)
    if (Date.now() >= this.state.refreshExpiresAt) {
      throw new Error(
        'Schwab refresh token has expired (7-day limit). Re-authorize at: ' +
        this.getAuthorizationUrl()
      )
    }

    // Refresh access token if expired or about to expire
    if (Date.now() >= this.state.expiresAt - REFRESH_BUFFER_MS) {
      await this.refresh()
    }

    return this.state.accessToken
  }

  /** Whether we have tokens (may still need refresh). */
  get isAuthorized(): boolean {
    return this.state !== null
  }

  /** Load tokens from disk. Returns true if tokens were found. */
  async loadFromDisk(): Promise<boolean> {
    try {
      const raw = await readFile(this.config.tokenFile, 'utf-8')
      this.state = JSON.parse(raw) as SchwabTokenState
      return true
    } catch {
      return false
    }
  }

  // ---- Internal ----

  private async refresh(): Promise<void> {
    // Deduplicate concurrent refresh calls
    if (this.refreshPromise) {
      await this.refreshPromise
      return
    }

    this.refreshPromise = this._doRefresh()
    try {
      await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async _doRefresh(): Promise<void> {
    if (!this.state) throw new Error('Cannot refresh — no token state')

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.state.refreshToken,
    })

    const response = await this.tokenRequest(body)
    this.state = this.responseToState(response)
    await this.persist()
  }

  /**
   * Make a token request to Schwab's OAuth endpoint.
   * Uses Basic auth with appKey:appSecret per Schwab's spec.
   */
  private async tokenRequest(body: URLSearchParams): Promise<SchwabTokenResponse> {
    const credentials = Buffer.from(`${this.config.appKey}:${this.config.appSecret}`).toString('base64')

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: body.toString(),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`Schwab OAuth error (${res.status}): ${errBody}`)
    }

    return await res.json() as SchwabTokenResponse
  }

  private responseToState(response: SchwabTokenResponse): SchwabTokenState {
    const now = Date.now()
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: now + response.expires_in * 1000,
      refreshExpiresAt: now + REFRESH_TOKEN_LIFETIME_MS,
    }
  }

  private async persist(): Promise<void> {
    if (!this.state) return
    try {
      await mkdir(dirname(this.config.tokenFile), { recursive: true })
      await writeFile(this.config.tokenFile, JSON.stringify(this.state, null, 2) + '\n')
    } catch (err) {
      console.warn(`SchwabAuth: failed to persist tokens: ${err instanceof Error ? err.message : err}`)
    }
  }
}
