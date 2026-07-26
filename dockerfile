FROM node:22-slim

WORKDIR /usr/src/app

# package*.json ya matchea package-lock.json
COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3003

CMD ["npm", "run", "start:dev"]
