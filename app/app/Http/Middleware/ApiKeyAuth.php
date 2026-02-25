<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ApiKeyAuth
{
    public function handle(Request $request, Closure $next): Response
    {
        $apiKey = config('zomboid.api_key');

        if (empty($apiKey)) {
            return response()->json([
                'error' => 'API key not configured on server',
            ], Response::HTTP_INTERNAL_SERVER_ERROR);
        }

        $providedKey = $request->header('X-API-Key');

        if (empty($providedKey) || ! hash_equals($apiKey, $providedKey)) {
            return response()->json([
                'error' => 'Unauthorized',
            ], Response::HTTP_UNAUTHORIZED);
        }

        return $next($request);
    }
}
