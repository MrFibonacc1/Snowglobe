FROM node:22-alpine AS build
WORKDIR /app
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
ARG VITE_AUTOMATION_URL=http://localhost:8000
ARG VITE_PERCEPTION_URL=http://localhost:8008
ENV VITE_AUTOMATION_URL=$VITE_AUTOMATION_URL VITE_PERCEPTION_URL=$VITE_PERCEPTION_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
