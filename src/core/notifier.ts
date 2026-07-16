/**
 * Simple notification client for sending updates from CLI to web server
 */

export class NotificationClient {
  constructor(
    private serverUrl: string = 'http://localhost:8080',
    private timeout: number = 5000 // Increased timeout
  ) {}

  /**
   * Update the server URL (useful when server starts on different port)
   */
  setServerUrl(url: string): void {
    this.serverUrl = url;
  }

  /**
   * Attempt to notify the web server of a change
   * Fails silently if server is not running
   */
  private async notify(endpoint: string, data?: any): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.serverUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      
      // Don't throw on HTTP errors, just log for debugging
      if (!response.ok) {
        console.log(`⚠️  Notification failed: ${response.status} - ${endpoint}`);
      } else {
        console.log(`✓ Notification sent successfully: ${endpoint}`);
      }
    } catch (error) {
      // Silently fail - server might not be running
      console.log(`⚠️  Server notification failed for ${endpoint}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Notify server that a ticket was created
   */
  async notifyTicketCreated(ticket: any): Promise<void> {
    await this.notify('/api/cli-notifications/ticket-created', ticket);
  }

  /**
   * Notify server that a ticket was updated  
   */
  async notifyTicketUpdated(ticket: any): Promise<void> {
    await this.notify('/api/cli-notifications/ticket-updated', ticket);
  }

  /**
   * Notify server that a ticket was deleted
   */
  async notifyTicketDeleted(id: string): Promise<void> {
    await this.notify('/api/cli-notifications/ticket-deleted', { id });
  }

  /**
   * Notify server that a sprint was created
   */
  async notifySprintCreated(sprint: any): Promise<void> {
    await this.notify('/api/cli-notifications/sprint-created', sprint);
  }

  /**
   * Notify server that a sprint was updated
   */
  async notifySprintUpdated(sprint: any): Promise<void> {
    await this.notify('/api/cli-notifications/sprint-updated', sprint);
  }

  /**
   * Notify server that a user was created
   */
  async notifyUserCreated(user: any): Promise<void> {
    await this.notify('/api/cli-notifications/user-created', user);
  }

  /**
   * Notify server that a user was updated
   */
  async notifyUserUpdated(user: any): Promise<void> {
    await this.notify('/api/cli-notifications/user-updated', user);
  }

  /**
   * Notify server that a user was deleted
   */
  async notifyUserDeleted(id: string): Promise<void> {
    await this.notify('/api/cli-notifications/user-deleted', { id });
  }

  /**
   * Notify server that a sprint was deleted
   */
  async notifySprintDeleted(id: string): Promise<void> {
    await this.notify('/api/cli-notifications/sprint-deleted', { id });
  }

  /**
   * Notify server that a comment was created
   */
  async notifyCommentCreated(comment: any): Promise<void> {
    await this.notify('/api/cli-notifications/comment-created', comment);
  }

  /**
   * Notify server that a comment was deleted
   */
  async notifyCommentDeleted(commentId: string, ticketId: string): Promise<void> {
    await this.notify('/api/cli-notifications/comment-deleted', { id: commentId, ticketId });
  }
}

import { existsSync, readFileSync } from 'fs';

/**
 * Try to read server config from .tkxr-server file, then fall back to env vars,
 * then to the default localhost:8080. The .tkxr-server JSON file is written by
 * `tkxr serve` so CLI/MCP-stdio invocations pointing at a custom host/port
 * automatically notify the running web server on the correct URL.
 */
function getDefaultServerUrl(): string {
  try {
    const configPath = './.tkxr-server';
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      if (config.url) return config.url;
      const host = config.host || 'localhost';
      const port = config.port || 8080;
      return `http://${host}:${port}`;
    }
  } catch (error) {
    // Ignore errors, fall back to defaults
    console.debug('Could not read server config:', error);
  }

  // Fallback to environment or default. Honor either an explicit URL or the
  // same TKXR_HOST/TKXR_PORT pair that `tkxr serve` accepts.
  if (process.env.TKXR_SERVER_URL) return process.env.TKXR_SERVER_URL;
  const envHost = process.env.TKXR_HOST || 'localhost';
  const envPort = process.env.TKXR_PORT || process.env.PORT || '8080';
  return `http://${envHost}:${envPort}`;
}

// Global instance - can be reconfigured at runtime
export const notifier = new NotificationClient(getDefaultServerUrl());