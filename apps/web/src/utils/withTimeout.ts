/**
 * Timeout utility for async operations
 * Prevents hanging promises by enforcing time limits
 */

export class TimeoutError extends Error {
  constructor(message: string, public readonly operation: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Wraps a promise with a timeout
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operation - Operation name for error messages
 * @returns Promise that rejects with TimeoutError if timeout is reached
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(
        `Operation timed out after ${timeoutMs}ms`,
        operation
      ));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Retry a function with exponential backoff
 * @param fn - Function to retry
 * @param maxRetries - Maximum number of retries
 * @param baseDelayMs - Base delay between retries (doubles each time)
 * @param operationName - Name for logging
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
  operationName: string = 'operation'
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`${operationName} failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
}

/**
 * Check if API is healthy
 * @param apiBaseUrl - Base URL of API
 * @param timeoutMs - Timeout for health check
 * @returns Promise that resolves to true if healthy, false otherwise
 */
export async function checkAPIHealth(
  apiBaseUrl: string,
  timeoutMs: number = 5000
): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
  const startTime = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${apiBaseUrl}/health`, {
      signal: controller.signal,
      method: 'GET',
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return { healthy: true, latencyMs };
    } else {
      return { 
        healthy: false, 
        error: `HTTP ${response.status}`,
        latencyMs 
      };
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    
    if (error instanceof Error && error.name === 'AbortError') {
      return { 
        healthy: false, 
        error: `Timeout after ${timeoutMs}ms`,
        latencyMs 
      };
    }
    
    return { 
      healthy: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      latencyMs 
    };
  }
}
