import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

export interface TelemetryConfig {
  serviceName: string;
  jaegerEndpoint?: string;
  enableConsole?: boolean;
}

export class TelemetryManager {
  private sdk: NodeSDK;

  constructor(config: TelemetryConfig) {
    // Set service name via env to avoid Resource peer dep hell
    process.env.OTEL_SERVICE_NAME = config.serviceName;

    const traceExporter = new OTLPTraceExporter({
      url: config.jaegerEndpoint || 'http://localhost:4318/v1/traces',
    });

    this.sdk = new NodeSDK({
      traceExporter,
      instrumentations: [],
    });
  }

  start() {
    this.sdk.start();
  }

  async shutdown() {
    await this.sdk.shutdown();
  }
}
