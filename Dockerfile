# build stage
FROM node:12.2.0-alpine as build-stage

# set working directory as app folder
WORKDIR /usr/src/app

# expose Node.js binaries to our PATH environment variable
# ENV PATH /usr/src/app/node_modules/.bin:$PATH

# copy files into working directory
COPY package*.json /usr/src/app/

# install dependencies
RUN npm install

# copy into app folder
COPY . /usr/src/app

# expose port
EXPOSE 8080

# run app
CMD [ "node", "index.js" ]