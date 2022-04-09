const { readFileSync } = require("fs");
const crypto = require("crypto");
const mysql = require("mysql");
const express = require("express");

const makeDb = require("./db");

try {
	var config = readFileSync('./config.json');
	config = JSON.parse(config);
} catch(error) {
	console.error("Failed to read config file");
	process.exit(1);
}

const db = makeDb(config.database);

const app = express();

const generateToken = (type, userId) => {
	const tokenData = crypto.randomBytes(16);

	const token = {
		token: tokenData,
		type,
		user_id: userId,
		scopes: ""
	};

	const query = mysql.format("INSERT INTO `tokens` SET ?", token);

	return db.query(query).then(results => token);
};

app.get('/', (req, res) => {
	res.sendFile(__dirname + '/public/index.html');
});

app.get('/login', (req, res) => {
	if (!req.query.hasOwnProperty('id')) {
		res.send('Error: No ID speficied');
		return;
	}

	const rawId = req.query.id;

	if (typeof rawId !== 'string' || rawId.length !== 16) {
		res.send('Error: ID is not in the correct format');
		return;
	}

	const id = Buffer.from(rawId, 'hex');

	if (id.length !== 8) {
		res.send('Error: ID was malformed');
		return;
	}

	const query = mysql.format("SELECT * FROM `users` WHERE `id` = ?", [id]);

	db.query(query)
	.then(users => {
		if (users.length < 1) {
			res.send('Error: Could not find matching user');
			return;
		}

		const authCode = crypto.randomBytes(12);

		const setAuthCodeQuery = mysql.format("UPDATE `users` SET `auth_code` = ? WHERE `id` = ?", [authCode, users[0].id]);
		Promise.all([
			db.query(setAuthCodeQuery),
			generateToken(0, id)
		])
		.then((results) => {
			res.redirect(config.redirect_uri + '?token=' + results[1].token.toString('hex'));
		})
		.catch(error => {
			console.error(error);
			res.send('Error: error occurred processing login');
		})
	})
	.catch(error => {
		console.error(error);
		res.send('Error: Could not find matching user');
	})
});

app.get('/api/users/me', (req, res) => {
	if (!req.query.token) {
		res.status(403).send({ error: "Token required" });
		return;
	}

	const rawToken = req.query.token;

	if (typeof rawToken !== 'string' || rawToken.length !== 32){
		res.status(403).send({ error: "Invalid token" });
		return;
	}

	const token = Buffer.from(rawToken, 'hex');

	if (token.length !== 16) {
		res.status(403).send({ error: "Invalid token" });
		return;
	}

	const userQuery = mysql.format("SELECT `users`.* FROM `users` LEFT JOIN `tokens` ON `users`.`id` = `tokens`.`user_id` WHERE `tokens`.`token` = ?", token);

	db.query(userQuery)
	.then(users => {
		if (users.length < 1) {
			res.status(403).send({ error: "Invalid token" });
			return;
		}

		const formattedUsers = users.map(user => {
			return {
				id: user.id.toString('hex'),
				username: user.username,
				email: user.email,
				name: user.name,
				profile_image_url: user.profile_image_url
			};
		});

		res.status(200).send({ users: formattedUsers });
	})
	.catch(error => {
		res.status(500).send({ error: "Error processing request" });
	});
});

app.listen(9900, () => {
	console.log("Fake auth listening on 9900");
});