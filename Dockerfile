FROM node:22-bookworm-slim

WORKDIR /app/project/backend

COPY project/backend/package.json project/backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY project/backend ./
COPY database /app/database
COPY utils /app/utils
COPY miniprogram/data /app/miniprogram/data

# Build a clean, public-data-only SQLite database for the experience version.
RUN DATABASE_PATH=/app/database/runtime/njust-math-stat.sqlite npm run db:migrate \
  && DATABASE_PATH=/app/database/runtime/njust-math-stat.sqlite npm run db:seed

RUN groupadd --system app \
  && useradd --system --gid app --home-dir /app app \
  && chown -R app:app /app

USER app
ENV NODE_ENV=production
ENV DB_DRIVER=sqlite
ENV DATABASE_PATH=/app/database/runtime/njust-math-stat.sqlite
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-ec", "if [ \"${MYSQL_BOOTSTRAP_ON_START:-0}\" = \"1\" ]; then MYSQL_EXECUTE=1 npm run db:mysql:migrate && MYSQL_EXECUTE=1 npm run db:mysql:seed; fi; exec npm start"]
