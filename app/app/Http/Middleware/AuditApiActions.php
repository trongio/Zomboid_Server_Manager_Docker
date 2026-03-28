<?php

namespace App\Http\Middleware;

use App\Services\AuditLogger;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuditApiActions
{
    public function __construct(private AuditLogger $auditLogger) {}

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $this->auditLogger->log(
            actor: 'api-key',
            action: strtolower($request->method()).':'.ltrim($request->path(), '/'),
            target: null,
            details: $this->buildDetails($request, $response),
            ip: $request->ip(),
        );

        return $response;
    }

    /**
     * @return array<string, mixed>
     */
    private function buildDetails(Request $request, Response $response): array
    {
        $details = [
            'method' => $request->method(),
            'path' => '/'.$request->path(),
            'status' => $response->getStatusCode(),
        ];

        $body = $request->except([
            'password',
            'password_confirmation',
            'api_key',
            'token',
            'secret',
            'current_password',
            'two_factor_secret',
            'two_factor_recovery_codes',
        ]);
        if ($body !== []) {
            $details['body'] = $body;
        }

        return $details;
    }
}
