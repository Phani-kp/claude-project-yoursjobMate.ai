# syntax=docker/dockerfile:1

# ---- Build the React client ----
FROM node:22.19-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Install server production dependencies ----
FROM node:22.19-slim AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime ----
FROM node:22.19-slim
# All data (accounts, profiles, resumes, applications) lives in the PostgreSQL database at DATABASE_URL,
# so the container keeps no data of its own and can be replaced on every deploy.
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=server-deps /app/server/node_modules server/node_modules
COPY server/ server/
COPY --from=client /app/client/dist client/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/server
CMD ["node", "--no-warnings", "src/index.js"]
