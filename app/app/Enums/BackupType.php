<?php

namespace App\Enums;

enum BackupType: string
{
    case Manual = 'manual';
    case Scheduled = 'scheduled';
    case Daily = 'daily';
    case PreRollback = 'pre_rollback';
    case PreUpdate = 'pre_update';
    case PreImport = 'pre_import';
}
