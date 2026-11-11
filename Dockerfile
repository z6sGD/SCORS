FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["npx", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8080", "--remote=false"]
