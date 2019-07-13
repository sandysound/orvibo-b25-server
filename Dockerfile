FROM node:10

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./


# Bundle app source
COPY . .

EXPOSE 3000 10001
CMD [ "node", "Example.js" ]