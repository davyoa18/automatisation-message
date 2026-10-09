# Image de production : Node 22 + Chromium (rendu des ébauches) fournis par l'image officielle Playwright.
FROM mcr.microsoft.com/playwright:v1.64.0-noble AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
COPY labo ./labo
RUN npx tsc -p tsconfig.json

FROM mcr.microsoft.com/playwright:v1.64.0-noble
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY prompts ./prompts
COPY studio ./studio
ENV PROJECT_ROOT=/app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/main.js"]
