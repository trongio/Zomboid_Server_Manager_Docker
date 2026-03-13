<?php

namespace App\Enums;

enum PromotionScope: string
{
    case All = 'all';
    case Category = 'category';
    case Item = 'item';
    case Bundle = 'bundle';
}
