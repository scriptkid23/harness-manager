import { Langfuse } from "langfuse";

export interface TracerEnv {
  LANGFUSE_HOST?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
}

export interface Span {
  end(output: unknown): void;
}

export interface Session {
  readonly traceId: string | undefined;
  span(name: string, input: unknown): Span;
  end(scores?: Record<string, string>): Promise<void>;
}

export interface Tracer {
  startSession(repoName: string, projectId?: string): Session;
}

const NOOP_SPAN: Span = { end() {} };

/** Build a tracer. Missing keys => every method is a silent no-op (spec §6). */
export function createTracer(env: TracerEnv): Tracer {
  const enabled = Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
  if (!enabled) {
    return {
      startSession() {
        return {
          traceId: undefined,
          span: () => NOOP_SPAN,
          async end() {},
        };
      },
    };
  }

  const client = new Langfuse({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_HOST,
  });

  return {
    startSession(repoName, projectId) {
      const trace = client.trace({ name: `session:${repoName}`, metadata: { projectId } });
      return {
        traceId: trace.id,
        span(name, input) {
          const span = trace.span({ name, input });
          return { end: (output) => span.end({ output }) };
        },
        async end(scores) {
          if (scores) for (const [name, value] of Object.entries(scores)) trace.score({ name, value });
          await client.flushAsync();
        },
      };
    },
  };
}
