const { readFileSync, writeFileSync } = require("fs");
const https = require("https");
const crypto = require("crypto");
const mysql = require("mysql");

try {
	var config = readFileSync('./config.json');
	config = JSON.parse(config);
} catch(error) {
	console.error("Failed to read config file");
	process.exit(1);
}

var install = true;

if (process.argv.length > 2) {
	if (process.argv[2] === 'uninstall') {
		install = false;
	} else if (process.argv[2] === 'install') {
		install = true;
	} else {
		console.error("Invalid argument, usage: node install.js [install|uninstall]");
		process.exit(1);
	}
}

const connection = mysql.createConnection(config.database);

const dbConnected = new Promise((resolve, reject) => {
	connection.connect(error => {
		if (error) {
			reject(error);
		} else {
			resolve();
		}
	});
});

const promisedQuery = (query) => {
	return new Promise((resolve, reject) => {
		connection.query(query, (error, results, fields) => {
			if (error) {
				reject(error);
			} else {
				resolve(results);
			}
		});
	});
};

dbConnected.catch(error => {
	console.error(error);
	process.exit(1);
});

if (install) {
	const USERS_SCHEMA = "CREATE TABLE `users` (\
		`id` BINARY(8) NOT NULL,\
		`username` VARCHAR(100) NOT NULL,\
		`email` VARCHAR(100) NOT NULL,\
		`name` VARCHAR(100) NOT NULL COLLATE utf8mb4_bin,\
		`profile_image_url` TINYTEXT NOT NULL,\
		`auth_code` BINARY(12),\
		PRIMARY KEY (`id`)\
	);";

	const TOKENS_SCHEMA = "CREATE TABLE `tokens` (\
		`token` BINARY(16) NOT NULL,\
		`type` TINYINT NOT NULL DEFAULT 0,\
		`user_id` BINARY(8) NOT NULL,\
		`scopes` TEXT NOT NULL,\
		PRIMARY KEY (`token`),\
		KEY `user_id` (`user_id`)\
	);";
	
	const createTable = (connection, schema) => {
		return new Promise((resolve, reject) => {
			connection.query(schema, (error, results, fields) => {
				if (error) {
					reject(error);
				} else {
					resolve(results);
				}
			});
		});
	};
	
	dbConnected
		.then(() => {
			Promise.all([
				createTable(connection, USERS_SCHEMA),
				createTable(connection, TOKENS_SCHEMA)
			])
			.then(results => {
				console.log("Tables created");

				return new Promise((resolve, reject) => {
					const req = https.request({
						hostname: 'randomuser.me',
						port: 443,
						path: '/api/?results=30',
						method: 'GET'
					}, response => {
						var body = "";

						response.on('data', (data) => {
							body += data;
						});
			
						response.on('end', () => {
							if (response.complete) {
								try {
									const data = JSON.parse(body);
									resolve(data);
								} catch (error) {
									reject(error);
								}
							} else {
								reject("Request incomplete");
							}
						});
					});

					req.end();
				});
			})
			.then(fakeUsers => {
				const tuples = fakeUsers.results.map(fakeUser => {
					return [
						crypto.randomBytes(8),
						fakeUser.login.username,
						fakeUser.email,
						fakeUser.name.first + ' ' + fakeUser.name.last,
						fakeUser.picture.medium
					];
				});

				const query = mysql.format("INSERT INTO `users` (`id`, `username`, `email`, `name`, `profile_image_url`) VALUES ?", [tuples]);

				return promisedQuery(query).then(() => tuples);
			})
			.then(fakeUsers => {
				var accountMarkup = fakeUsers.map(fakeUser => {
					return '<a href="/login?id=' + fakeUser[0].toString('hex') + '">\n\
<div class="fake-user">\n\
	<div class="picture">\n\
		<img src="' + fakeUser[4] + '" />\n\
	</div>\n\
	<div class="details">\n\
		<h3>' + fakeUser[3] + '</h3>\n\
	</div>\n\
</div>\n\
</a>';
				}).join('');

				let template = readFileSync('./template.html', { encoding: 'utf-8' });
				template = template.replace('%FAKE_ACCOUNTS%', accountMarkup);
				writeFileSync('./public/index.html', template);
			})
			.finally(() => {
				connection.end();
			})
		});
} else {
	Promise.all([
		promisedQuery("DROP TABLE `users`;"),
		promisedQuery("DROP TABLE `tokens`;"),
	])
	.then(results => {
		console.log("Dropped tables");
	})
	.catch(error => {
		console.error("Failed to drop tables");
		console.error(error);
	})
	.finally(() => {
		connection.end();
	});
}