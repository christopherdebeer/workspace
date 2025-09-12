interface Config {
  apiUrl: string;
}

interface ConfigResponse {
  apiUrl: string;
  version: string;
}

// Configuration that can be determined at runtime
class ConfigService {
  private config: Config | null = null;

  async getConfig(): Promise<Config> {
    if (this.config) {
      return this.config;
    }

    // Try to get from environment variable first (for development)
    const envUrl = (import.meta.env.VITE_FUNCTION_URL as string | undefined);
    if (envUrl) {
      this.config = { apiUrl: envUrl };
      return this.config;
    }

    // For production, we need to discover the backend URL
    // Since we're on GitHub Pages, we can try a few strategies:
    
    // Strategy 1: Check if there's a deployed configuration
    // This would be set during build time if the deployment process includes it
    const buildTimeConfig = (window as any).__CONFIG__;
    if (buildTimeConfig?.apiUrl) {
      this.config = { apiUrl: buildTimeConfig.apiUrl };
      return this.config;
    }

    // Strategy 2: Try to fetch from a known config service
    // For now, we'll show a helpful error message
    console.warn('VITE_FUNCTION_URL is not defined and no runtime configuration found.');
    console.warn('For development: Set VITE_FUNCTION_URL in your .env file');
    console.warn('For production: The frontend needs to know the backend URL');
    
    this.config = { apiUrl: '' };
    return this.config;
  }

  // Method to set the config from external source
  setConfig(config: Config) {
    this.config = config;
  }
}

export const configService = new ConfigService();