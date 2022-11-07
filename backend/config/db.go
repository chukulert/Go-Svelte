package config

import (
	"database/sql"
	"log"
	"os"

	_ "github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
)

func GetMySQLDB() (db *sql.DB, err error) {
	cfg := godotenv.Load("../config/.env")
	if cfg != nil{
		log.Fatal("Error: env fail to load")
		os.Exit(1)
	}
	dbDriver := os.Getenv("DBDRIVER")
	dbUser := os.Getenv("DBUSER")
	dbPass := os.Getenv("DBPASS")
	dbName := os.Getenv("DBNAME")
	dbPort := os.Getenv("DBPORT")
	db, err = sql.Open(dbDriver, dbUser + ":" + dbPass + "@tcp(localhost:"+ dbPort + ")/" + dbName)
	return 
}
