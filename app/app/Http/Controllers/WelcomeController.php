<?php

namespace App\Http\Controllers;

use App\Models\ServerSetting;
use App\Models\SiteSetting;
use App\Services\PlayerStatsService;
use App\Services\ServerStatusResolver;
use Inertia\Inertia;
use Inertia\Response;
use Laravel\Fortify\Features;

class WelcomeController extends Controller
{
    public function __construct(
        private readonly ServerStatusResolver $statusResolver,
        private readonly PlayerStatsService $playerStatsService,
    ) {}

    public function __invoke(): Response
    {
        $resolved = $this->statusResolver->resolve();

        $server = [
            'online' => $resolved['online'],
            'status' => $resolved['game_status'],
            'player_count' => $resolved['player_count'],
            'players' => $resolved['players'],
            'map' => $resolved['map'],
        ];

        $siteSettings = SiteSetting::cached();

        return Inertia::render('welcome', [
            'canRegister' => Features::enabled(Features::registration()),
            'server' => $server,
            'server_stats' => Inertia::defer(fn () => $this->playerStatsService->getServerStats()),
            'top_players' => Inertia::defer(fn () => $this->playerStatsService->getLeaderboard('zombie_kills', 3)),
            'server_name' => config('zomboid.server_name', 'Project Zomboid Server'),
            'connection' => fn () => [
                'ip' => ($ss = ServerSetting::instance())->server_ip,
                'port' => $ss->server_port,
            ],
            'hero' => [
                'badge' => $siteSettings->hero_badge,
                'title' => $siteSettings->hero_title,
                'subtitle' => $siteSettings->hero_subtitle,
                'description' => $siteSettings->hero_description,
                'button_text' => $siteSettings->hero_button_text,
            ],
            'features' => $siteSettings->features ?? SiteSetting::defaultFeatures(),
            'landing_sections' => $siteSettings->landing_sections ?? SiteSetting::defaultLandingSections(),
        ]);
    }
}
