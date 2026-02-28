import { toast } from 'sonner';

type FetchActionOptions = {
    method?: string;
    data?: Record<string, unknown>;
    successMessage?: string;
};

/**
 * Wrapper around fetch for admin actions with automatic toast feedback.
 * Parses JSON response and shows success/error toasts.
 * Returns the parsed JSON data on success, or null on failure.
 */
export async function fetchAction(
    url: string,
    options: FetchActionOptions = {},
): Promise<Record<string, unknown> | null> {
    const { method = 'POST', data, successMessage } = options;
    const csrfToken =
        document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';

    // Laravel method spoofing: send PUT/PATCH/DELETE as POST with _method in body
    const spoofed = ['PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
    const actualMethod = spoofed ? 'POST' : method;

    const body = data
        ? JSON.stringify(spoofed ? { ...data, _method: method } : data)
        : spoofed
            ? JSON.stringify({ _method: method })
            : undefined;

    const headers: Record<string, string> = { 'X-CSRF-TOKEN': csrfToken };
    if (spoofed) {
        headers['X-HTTP-Method-Override'] = method.toUpperCase();
    }
    if (body) {
        headers['Content-Type'] = 'application/json';
    }

    try {
        const res = await fetch(url, {
            method: actualMethod,
            headers,
            body,
        });

        const json = await res.json().catch(() => ({}));

        if (res.ok) {
            toast.success(
                successMessage || json.message || 'Action completed',
            );
            return json;
        }

        toast.error(json.error || json.message || `Request failed (${res.status})`);
        return null;
    } catch {
        toast.error('Network error — could not reach the server');
        return null;
    }
}
