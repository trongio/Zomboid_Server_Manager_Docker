FROM php:8.3-fpm-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    nginx \
    supervisor \
    curl \
    libpq-dev \
    sqlite-dev \
    linux-headers \
    nodejs \
    npm

# Install PHP extensions
RUN docker-php-ext-install \
    pdo_pgsql \
    pdo_sqlite \
    sockets \
    pcntl \
    opcache

# Install Redis extension
RUN apk add --no-cache --virtual .build-deps $PHPIZE_DEPS \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apk del .build-deps

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Copy composer files first for layer caching
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

# Copy package files and install + build frontend
COPY package.json package-lock.json ./
RUN npm ci

# Copy application code
COPY . .

# Generate autoload BEFORE npm build (Wayfinder plugin needs artisan)
RUN composer dump-autoload --optimize --no-dev

# Build frontend assets
# Wayfinder plugin runs `php artisan wayfinder:generate` which needs APP_KEY
# and a working DB driver. Use SQLite stub + temp key for build only.
RUN APP_KEY=base64:dGVtcG9yYXJ5LWJ1aWxkLWtleS1mb3ItZG9ja2VyMTIzNA== \
    DB_CONNECTION=sqlite \
    DB_DATABASE=":memory:" \
    npm run build

# Set permissions
RUN chown -R www-data:www-data storage bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache

# Nginx configuration
COPY docker/nginx.conf /etc/nginx/http.d/default.conf

# Supervisor configuration
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# PHP production config
COPY docker/php.ini /usr/local/etc/php/conf.d/99-production.ini

EXPOSE 8000

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
