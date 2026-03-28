FROM php:8.3-fpm-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    nginx \
    supervisor \
    curl \
    libpq-dev \
    postgresql16-client \
    sqlite-dev \
    linux-headers \
    nodejs \
    npm \
    python3 \
    py3-pip \
    git

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

# Install pzmap2dzi for map tile generation (pyclipper needs C++ compiler)
RUN apk add --no-cache --virtual .pzmap-build-deps g++ python3-dev \
    && git clone --depth 1 https://github.com/cff29546/pzmap2dzi.git /opt/pzmap2dzi \
    && pip3 install --break-system-packages lupa pyclipper pillow pyyaml ruamel.yaml \
    && apk del .pzmap-build-deps

# Copy package files and install + build frontend
COPY package.json package-lock.json ./
RUN npm ci

# Copy application code
COPY . .

# Generate autoload & discover packages (purges dev-only providers from cache)
RUN composer dump-autoload --optimize --no-dev \
    && APP_KEY=base64:dGVtcG9yYXJ5LWJ1aWxkLWtleS1mb3ItZG9ja2VyMTIzNA== \
       DB_CONNECTION=sqlite DB_DATABASE=":memory:" \
       php artisan package:discover --ansi

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

# Entrypoint — fixes Docker socket permissions at runtime
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# PHP production config
COPY docker/php.ini /usr/local/etc/php/conf.d/99-production.ini

EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
