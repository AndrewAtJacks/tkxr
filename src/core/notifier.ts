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
        console.debug(`Notification failed: ${response.status}`);
      }
    } catch (error) {
      // Silently fail - server might not be running
      console.debug('Server notification failed:', error instanceof Error ? error.message : 'Unknown error');
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
}

import { existsSync, readFileSync } from 'fs';

/**
 * Try to read server config from .tkxr-server file
 */
function getDefaultServerUrl(): string {
  try {
    const configPath = './.tkxr-server';
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      return config.url || `http://localhost:${config.port || 8080}`;
    }
  } catch (error) {
    // Ignore errors, fall back to defaults
    console.debug('Could not read server config:', error);
  }
  
  // Fallback to environment or default
  return process.env.TKXR_SERVER_URL || `http://localhost:${process.env.TKXR_PORT || 8080}`;
}

// Global instance - can be reconfigured at runtime
export const notifier = new NotificationClient(getDefaultServerUrl());