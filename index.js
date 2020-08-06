const fetch = require('node-fetch');
const { Pool } = require('pg');
const poolConfig = {
    user: process.env.user,
    host: process.env.host,
    database: process.env.database,
    password: process.env.password,
    port: process.env.port
};
const pool = new Pool(poolConfig);

function encodeForm(data) {
    return Object.keys(data).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key])).join('&');
}

exports.handler = async(event) => {
    console.log("BEGIN guardianbrothers: ", event);
    if (event.path === '/callback') {
        let response1 = await fetch('https://api.tdameritrade.com/v1/oauth2/token', {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: encodeForm({
                grant_type: 'authorization_code',
                code: decodeURIComponent(event.queryStringParameters.code),
                access_type: 'offline',
                redirect_uri: process.env.redirect_uri,
                client_id: process.env.client_id
            })
        });
        response1 = await response1.json();
        console.log(response1);
        try {
            await pool.query("UPDATE configuration SET value = $1 WHERE id = 'refresh_token'", [response1.refresh_token]);
            return { statusCode: 200, body: JSON.stringify({ response: "success", message: "saved new refresh_token. this will last for another 90 days." }), headers: { 'Access-Control-Allow-Origin': '*' } };
        }
        catch (err) {
            console.log(err);
            return { statusCode: 400, body: JSON.stringify({ response: "error", message: "there was an error, we couldn't save a new refresh_token." }), headers: { 'Access-Control-Allow-Origin': '*' } };
        }
    }
    else if (event.path === '/save') {
        let refresh_token = await pool.query("SELECT value FROM configuration WHERE id='refresh_token'");
        let response1 = await fetch('https://api.tdameritrade.com/v1/oauth2/token', {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: encodeForm({
                grant_type: 'refresh_token',
                refresh_token: refresh_token.rows[0].value,
                redirect_uri: process.env.redirect_uri,
                client_id: process.env.client_id
            })
        });
        response1 = await response1.json();
        let response2 = await fetch(`https://api.tdameritrade.com/v1/accounts/${process.env.account_number}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${response1.access_token}` }
        });
        response2 = await response2.json();
        console.log(response2);
        let shares_outstanding = await pool.query("SELECT value FROM configuration WHERE id='shares_outstanding'");
        try {
            let response3 = await pool.query('INSERT INTO liquidation_value(value, shares) VALUES($1, $2) RETURNING *', [response2.securitiesAccount.currentBalances.liquidationValue, parseFloat(shares_outstanding.rows[0].value)]);
            return { statusCode: 200, body: JSON.stringify(response3.rows), headers: { 'Access-Control-Allow-Origin': '*' } };
        }
        catch (err) {
            console.log(err);
            return { statusCode: 400, body: "there was an error, we probably already have a value for today.", headers: { 'Access-Control-Allow-Origin': '*' } };
        }
    }
    else if (event.path === '/auth') {
        return { statusCode: 302, headers: { Location: process.env.auth_uri } };
    }
    else if (event.path === '/stats') {
        try {
            let response = await pool.query('SELECT * FROM liquidation_value ORDER BY id DESC');
            return { statusCode: 200, body: JSON.stringify(response.rows), headers: { 'Access-Control-Allow-Origin': '*' } };
        }
        catch (err) {
            console.log(err);
            return { statusCode: 400, body: "there was an error", headers: { 'Access-Control-Allow-Origin': '*' } };
        }
    }
    else if (event.path === '/update') {
        if (event.queryStringParameters) {
            if (event.queryStringParameters.shares) {
                try {
                    await pool.query("UPDATE configuration SET value = $1 WHERE id = 'shares_outstanding'", [event.queryStringParameters.shares]);
                    return { statusCode: 200, body: `Shares outstanding updated to ${event.queryStringParameters.shares}`, headers: { 'Access-Control-Allow-Origin': '*' } };
                }
                catch (err) {
                    console.log(err);
                    return { statusCode: 400, body: "there was an error", headers: { 'Access-Control-Allow-Origin': '*' } };
                }
            }
            else {
                return { statusCode: 400, body: "There was error processing your update- if you're trying to update the shares outstanding, make sure you follow this URL format: https://api.guardianbrothers.com/update?shares=3000", headers: { 'Access-Control-Allow-Origin': '*' } };
            }
        }
        else {
            return { statusCode: 400, body: "There was error processing your update- if you're trying to update the shares outstanding, make sure you follow this URL format: https://api.guardianbrothers.com/update?shares=3000", headers: { 'Access-Control-Allow-Origin': '*' } };
        }
    }
    else if (event.path === '/positions') {
        let refresh_token = await pool.query("SELECT value FROM configuration WHERE id='refresh_token'");
        let response1 = await fetch('https://api.tdameritrade.com/v1/oauth2/token', {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: encodeForm({
                grant_type: 'refresh_token',
                refresh_token: refresh_token.rows[0].value,
                redirect_uri: process.env.redirect_uri,
                client_id: process.env.client_id
            })
        });
        response1 = await response1.json();
        let response2 = await fetch(`https://api.tdameritrade.com/v1/accounts/${process.env.account_number}?fields=positions`, {
            method: "GET",
            headers: { Authorization: `Bearer ${response1.access_token}` }
        });
        response2 = await response2.json();
        console.log(response2);
        response2.securitiesAccount.positions = response2.securitiesAccount.positions.sort((a,b)=>b.marketValue-a.marketValue);
        return { statusCode: 200, body: JSON.stringify({positions: response2.securitiesAccount.positions, liquidationValue: response2.securitiesAccount.currentBalances.liquidationValue, cashBalance: response2.securitiesAccount.currentBalances.cashBalance}), headers: { 'Access-Control-Allow-Origin': '*' } };
    }
};
