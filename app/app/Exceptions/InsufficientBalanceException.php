<?php

namespace App\Exceptions;

use RuntimeException;

class InsufficientBalanceException extends RuntimeException
{
    public function __construct(
        public readonly float $balance,
        public readonly float $required,
    ) {
        parent::__construct("Insufficient balance: have {$balance}, need {$required}");
    }
}
