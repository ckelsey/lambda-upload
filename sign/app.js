const https = require('https')
const url = require('url')
const AWS = require("aws-sdk")
const s3 = new AWS.S3({})
const EXPIRES = process.env.EXPIRES
const AUTHURL = process.env.AUTHURL
const BUCKET = process.env.BUCKET
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

const AuthRequestParams = (userToken, userId) => {
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

        return https.request(AuthRequestParams(userToken, userId), Response => {
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

const GetS3Url = name => {
    return new Promise((resolve, reject) => {
        const expiresIn = new Date().getTime() + (EXPIRES * 1000)
        const params = {
            Bucket: BUCKET,
            Key: name,
            Expires:EXPIRES,
            ContentType: `application/octet-stream`
        }

        console.log(`URL GET:`, params)

        return s3.getSignedUrl('putObject', params, (error, url) => {
            
            console.log(`URL RETRIEVED: `, url, error)

            if (error) { return reject(error) }

            return resolve({
                url,
                expires: expiresIn
            })
        })
    })
}

exports.handler = (event, context, callback) => {
    const body = event.body && typeof event.body === `string` && event.body !== `` ? JSON.parse(event.body) : event
    const userId = body.userId
    const userToken = body.userToken
    const total = body.total
    const mime = body.mime
    const time = new Date().getTime()
    const rand = Math.round((Math.random() * time) * total)
    const keyPrefix = `${userId}_${time}_${total}_${rand}`

    if (!userId) {
        callback(`Invalid user id`)
        return
    }

    if (!userToken) {
        callback(`Invalid user token`)
        return
    }

    if (!mime) {
        callback(`Invalid mime`)
        return
    }

    if (total === undefined) {
        callback(`Invalid total`)
        return
    }

    console.log(`userId: ${userId}, total: ${total}, mime: ${mime}, keyPrefix: ${keyPrefix}, userToken: ${userToken}`)

    return ValidateUser(userId, userToken)
        .then(data => {
            console.log(`USER RESPONSE:`, JSON.stringify(data))

            const promiseArray = []
            let index = 0

            while (index < total) {
                promiseArray.push(`${keyPrefix}_${index}`)
                index = index + 1
            }

            console.log(`PROMISES`, promiseArray)

            return Promise.all(promiseArray.map(GetS3Url))
                .then(urls => {
                    console.log(`URLS`)
                    console.log(urls)
                    callback(null, Object.assign({}, response, { body: JSON.stringify(urls) }))
                })
                .catch(callback)
        })
        .catch(error => {
            console.log(`ValidateUser error`, error)
            callback(error)
        })
}
