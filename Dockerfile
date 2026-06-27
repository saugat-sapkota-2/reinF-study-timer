FROM php:8.2-cli

# Install PDO MySQL extension
RUN docker-php-ext-install pdo_mysql

WORKDIR /app

COPY . .

EXPOSE 10000

CMD ["php", "-S", "0.0.0.0:10000"]