# The weather engine for the hosted game (Railway: railway.json, docs/HOSTING.md).
# No npm packages: only the server, the engine and the three Node pages go in.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY server ./server
COPY js ./js
COPY tools/cloudlab/worker ./tools/cloudlab/worker
COPY scripts/build-world-map.mjs ./scripts/build-world-map.mjs
COPY index.html models.html performance.html outlook.html product.html chasers.html synoptic.html home.html products.html warnings.html days.html about.html 404.html ./
COPY css ./css
COPY site ./site
COPY fonts ./fonts
# The world map the products and damage surveys read (gitignored locally; a few seconds to build).
RUN node scripts/build-world-map.mjs --seed 1 > /dev/null
CMD ["node", "server/index.js"]
