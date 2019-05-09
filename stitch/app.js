const https = require('https')
const url = require('url')
const AWS = require("aws-sdk")
const s3 = new AWS.S3({})
const AUTHURL = process.env.AUTHURL
const TARGETBUCKET = process.env.TARGETBUCKET
const SOURCEBUCKET = process.env.SOURCEBUCKET
const CLEANUP = process.env.CLEANUP

const getFileName = (path, ext) => {
    const split = getSourceKey(path).split(`_`)
    split.pop()
    return `${split.join(`_`)}.${ext}`
}

const getSourceKey = path => path.split(SOURCEBUCKET)[1]

const response = {
    statusCode: 200,
    headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Credentials': true,
        'Content-Type': 'application/json'
    },
    body: ``,
}

const AuthRequestParams = (userId, userToken) => {
    const AuthUrl = new url.parse(`${AUTHURL}${userId}`)

    return {
        host: AuthUrl.host,
        protocol: AuthUrl.protocol,
        path: AuthUrl.path,
        method: 'GET',
        headers: { 'Authorization': userToken }
    }
}

const ValidateUser = (userId, userToken) => {
    return new Promise((resolve, reject) => {

        console.log(`GETTING USER`)

        https.request(AuthRequestParams(userId, userToken), Response => {
            const buffers = []
            Response.on('data', (chunk) => { buffers.push(chunk) })
            Response.on('end', () => {
                const userDataBuffer = Buffer.concat(buffers).toString()
                const userData = JSON.parse(userDataBuffer)

                console.log(`USER DATA:`, userDataBuffer)

                if (!userData || !userData.id || userData.id !== userId) {
                    return reject(`Invalid user`)
                }

                return resolve(userData)
            })
            Response.on(`error`, error => reject(error))
        }).end()
    })
}

const getFileParams = path => ({
    Bucket: SOURCEBUCKET,
    Key: getSourceKey(path)
})

const getS3File = (path, index) => {
    return new Promise((resolve, reject) => {
        const params = getFileParams(path)
        console.log(`GET PARAMS: ${JSON.stringify(params)}`)

        return s3.getObject(params)
            .promise()
            .then(data => {
                console.log(`read:${index}`)
                console.log(data)
                return resolve(data.Body)
            })
            .catch(error => {
                console.log(`error:${index}`)
                console.log(error)
                return reject(error)
            })
    })
}

const deleteS3File = (path) => {
    return new Promise((resolve, reject) => {
        const params = getFileParams(path)
        console.log(`DELETE PARAMS: ${JSON.stringify(params)}`)

        s3.deleteObject(params, err => {
            if (err) { return reject(err) }
            return resolve()
        })
    })
}

const putS3File = (buffers, filename) => {
    return new Promise((resolve, reject) => {
        const params = {
            Bucket: TARGETBUCKET,
            Key: filename,
            Body: Buffer.concat(buffers)
        }

        console.log(`PUT PARAMS:`, JSON.stringify(params))

        return s3.putObject(params)
            .promise()
            .then(resolve)
            .catch(reject)
    })
}

exports.handler = (event, context, callback) => {
    const body = event.body && typeof event.body === `string` && event.body !== `` ? JSON.parse(event.body) : event
    const userId = body.userId
    const userToken = body.userToken
    const files = body.files
    const ext = body.ext

    if (!userId) {
        callback(`Invalid user id`)
        return
    }

    if (!userToken) {
        callback(`Invalid user token`)
        return
    }

    if (!ext) {
        callback(`Invalid ext`)
        return
    }

    if (files === undefined) {
        callback(`No files`)
        return
    }

    if (!Array.isArray(files)) {
        callback(`Invalid files`)
        return
    }

    console.log(`userId: ${userId}, files: ${files}, ext: ${ext}, userToken: ${userToken}`)
    console.log(`SOURCEBUCKET`, SOURCEBUCKET)
    console.log(`AUTHURL`, AUTHURL)
    console.log(`BUCKET`, TARGETBUCKET)

    const filename = getFileName(files[0], ext)
    const Response = Object.assign({}, response, { body: `${TARGETBUCKET}${filename}` })

    return ValidateUser(userId, userToken)
        .then(data => {
            console.log(`USER RESPONSE:`, JSON.stringify(data))

            return Promise.all(files.map(getS3File))
                .then(buffers => putS3File(buffers, filename))
                .then(() => {
                    if(!CLEANUP || CLEANUP === `false`){
                        return callback(null, Response)
                    }

                    return Promise.all(files.map(deleteS3File))
                        .then(() => callback(null, Response))
                        .catch(callback)
                })
                .catch(callback)
        })
        .catch(error => {
            console.log(`ValidateUser error`, error)
            callback(error)
        })
}
