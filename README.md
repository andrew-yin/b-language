# The 'B'/'--C' Language
The B language is a dynamically typed, interpreted language that is a subset of C. The language is designed to be simple and easy to use, while still allowing the user to have a deep control of memory.

## Building the Project
We first build the backend of the project as follows:
```
cd backend
yarn
yarn install
yarn build
yarn link
```
We then build the frontend of the project as follows:
```
cd frontend
yarn
yarn install
yarn link "c-slang"
```

## Deploying the Project
Deployment of the project can be done by running the following:
```
cd frontend
yarn run start
```
This will start a local version of the web application at `http://localhost:8000`.

## Testing the Project


