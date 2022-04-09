const mysql = require("mysql");

const makeDb = (config) => {
	const db = {
		pool: mysql.createPool(config),

		query: function(query) {
			return new Promise((resolve, reject) => {
				this.pool.query(query, (error, results, fields) => {
					if (error) {
						reject(error);
					} else {
						resolve(results);
					}
				});
			});
		}
	};

	db.query = db.query.bind(db);

	return db;
};

module.exports = makeDb