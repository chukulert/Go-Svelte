package models

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"myModule/src/entities"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"
)

type USERDB struct {
	Db *sql.DB
}

type NULL struct {
	Null sql.NullString
}

// to get all user accounts
func (d USERDB) GetAllUsers() ([]entities.Users, error) {
	result, err := d.Db.Query("SELECT * FROM accounts") //get all from users table
	if err != nil {
		return nil, err
	}
	defer result.Close()
	// fmt.Println(result)
	users := []entities.Users{}
	for result.Next() {
		var us entities.Users
		// fmt.Println(us.Name)
		if err := result.Scan(&us.Username, &us.Password, &us.Email, &us.Status, &us.BelongsTo); err != nil {
			users = append(users, us)
		}
		users = append(users, us)
	}
	// fmt.Println(users)
	return users, nil
}

func (d USERDB) GetUser(username string) (entities.Users, error) {
	user := entities.Users{}

	result, err := d.Db.Query("SELECT * FROM accounts WHERE username=?", username)
	if err != nil {
		return user, err
	}
	defer result.Close()
	for result.Next() {
		err := result.Scan(&user.Username, &user.Password, &user.Email, &user.Status, &user.BelongsTo)
		if err != nil {
			return user, err
		}
	}
	return user, err
}

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	return string(bytes), err
}

func CheckPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func (d USERDB) UpdateAllUserInfo(username string, password string, email string, status bool, belongsTo string, editor string) (string, error) {
	decodeToken, fail := DegenJWT(editor)
	if fail != nil {
		message := "Invalid user"
		return message, nil
	}
	if (d.CheckGroup(decodeToken, "admin") && !(decodeToken == username)) {
		// match, _ := regexp.MatchString("/^(?=.*[a-zA-Z0-9])(?=.*[!@#$%^&*()_+])[A-Za-z0-9!@#$%^&*()_+]/",password)
		// if(!match){
		// 	message := "Password does not meet requirement"
		// 	return message, nil
		// }
		hashPassword, _ := HashPassword(password)
		//insert values
		_, err := d.Db.Exec("UPDATE accounts SET email=?, password=?, status=?, belongsTo=? WHERE username=?;", email, hashPassword, status, belongsTo, username)
		if err != nil {
			message := username + " information not updated"
			return message, err
		}
		message := username + " information updated successful"
		return message, nil
	}
	message := username + " is not a admin role"
	return message, nil
}

func (d USERDB) RevertUserPassword(username string, password string, editor string) (string, error) {
	decodeToken, fail := DegenJWT(editor)
	if fail != nil {
		message := "Invalid user"
		return message, nil
	}
	if d.CheckGroup(decodeToken, "admin") {
		// hashPassword, _ := HashPassword(password)
		_, err := d.Db.Exec("UPDATE accounts SET password=? WHERE username=?;", password, username)
		if err != nil {
			message := username + " information not updated"
			return message, err
		}
		message := username + " information updated successful"
		return message, nil
	}else if (decodeToken == username){
		message := "you cannot change yourself"
		return message, nil
	}
	message := username + " is not a admin role"
	return message, nil
}

func (d USERDB) UpdateAllUserInfoEP(username string, status bool, email string, belongsTo string, editor string) (string, error) {
	decodeToken, fail := DegenJWT(editor)
	if fail != nil {
		message := "Invalid user"
		return message, nil
	}
	if (d.CheckGroup(decodeToken, "admin") && !(decodeToken == username)) {
		_, err := d.Db.Exec("UPDATE accounts SET email=?, status=?, belongsTo=? WHERE username=?;", email, status, belongsTo, username)
		if err != nil {
			message := username + " information not updated"
			return message, err
		}
		message := username + " information updated successful"
		return message, nil
	}else if (decodeToken == username){
		message := "you cannot change yourself"
		return message, nil
	}
	message := username + " is not a admin role"
	return message, nil
}

// GIN login
func (d USERDB) Auth(username string, password string) (bool, error) {
	var dbPass string
	var dbStatus bool
	getUserPwResult, err := d.Db.Query("SELECT password, status FROM accounts WHERE username = ? ;", username)
	if err != nil {
		log.Fatal(err)
		return false, err
	}
	a := 0
	for getUserPwResult.Next() { // checklength
		a++
		err := getUserPwResult.Scan(&dbPass, &dbStatus)
		if err != nil {
			log.Fatal(err)
		}
	}
	if a == 1 {
		if CheckPasswordHash(password, dbPass) && dbStatus {
			return true, nil //200
		}
		return false, nil //403 pwmismatch
	}
	return false, nil //403 usernotfound
}

// GIN Gets the list of belongs to from a given user
func (d USERDB) GetUserBelongsTo(username string) ([]string, error) {
	result, err := d.Db.Query("SELECT belongsTo FROM accounts WHERE username = ? ;", username)
	if err != nil {
		return nil, err
	}
	defer result.Close()
	var groupname string

	for result.Next() {
		err := result.Scan(&groupname)
		if err != nil {
			log.Fatal(err)
		}

	}
	return strings.Split(groupname, ","), nil
}

// GIN CHECKGROUP FUNCTION
func (d *USERDB) CheckGroup(username string, group string) bool {
	groups, err := d.GetUserBelongsTo(username)
	if err != nil {
		log.Fatal(err)
	}
	for _, a := range groups {
		if a == group {
			return true
		}
	}
	return false
}

//GIN GenerateJWT
func GenerateJWT(username string) (string, error) {
	cfg := godotenv.Load("../config/.env")
	if cfg != nil {
		log.Fatal("Error: env fail to load")
		os.Exit(1)
	}
	exp, err := strconv.ParseInt(os.Getenv("JWTEXPHR"), 10, 64)
	if err != nil {
		log.Fatal("Error: Jwt exp conv fail")
		os.Exit(1)
	}
	claims := entities.Claims{
		Username: username,
		StandardClaims: jwt.StandardClaims{
			ExpiresAt: time.Now().Local().Add(time.Hour * time.Duration(exp)).Unix(),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signedToken, err := token.SignedString([]byte(os.Getenv("JWTSECRET")))
	if err != nil {
		log.Fatal("Error: JWT sign fail")
		os.Exit(1)
	}
	return signedToken, nil
}

//GIN DECODE JWT
func DegenJWT(signedToken string) (string, error) {
	token, err := jwt.ParseWithClaims(
		signedToken,
		&entities.Claims{},
		func(token *jwt.Token) (interface{}, error) {
			return []byte(os.Getenv("JWTSECRET")), nil
		})
	if err != nil {
		// log.Fatal("Error: JWT auth f1")
		return "", errors.New("JWT auth f1")
	}
	claims, ok := token.Claims.(*entities.Claims)
	if !ok {
		// log.Fatal("Couldn't parse claims")
		return "", errors.New("Couldn't parse claims")
	}
	if claims.ExpiresAt < time.Now().Local().Unix() {
		// log.Fatal("JWT is expired")
		return "", errors.New("JWT is expired")

	}
	return claims.Username, nil
}

//GIN CREATEUSER
func (d *USERDB) CreateUser(username string, password string, email string) (bool, error) {
	_, err := d.Db.Query("INSERT INTO accounts(username,password,email,status,belongsTo) values(?,?,?,1,'');", username, password, email)
	if err != nil {
		return false, err
	}
	return true, nil
}
func (d *USERDB) EditEmail(username string, newemail string) (string, error) {
	// users := []entities.Users{}
	_, err := d.Db.Exec("UPDATE accounts SET email = ? WHERE username = ?;", newemail, username)
	if err != nil {
		return "error", err
	}
	return "Successfully Edited", nil
}

func (d *USERDB) EditPassword(username string, newpassword string) (string, error) {
	// users := []entities.Users{}
	// password := r.FormValue("password")
	// fmt.Println(password)
	hash, _ := HashPassword(newpassword)
	_, err := d.Db.Exec("UPDATE accounts SET password = ? WHERE username = ?;", hash, username)
	if err != nil {
		return "error", err
	}

	return "Successfully Edited", nil
}

// 1. Glenn Assign group to user

// add group to string of groups in accounts based on a user
func (d *USERDB) AssignGroupToUser(g string, usr string) (string, error) {

	currGrps, _ := d.GetUserBelongsTo(usr)
	// fmt.Println(strings.Join(currGrps,","))
	fmt.Println(len(currGrps))

	newGrps := strings.Join(append(currGrps, g), ",")
	fmt.Println(newGrps)

	sql := `UPDATE accounts SET belongsTo = ? WHERE username = ?`
	_, err := d.Db.Exec(sql, newGrps, usr)
	if err != nil {
		failure := "SQL database error"
		return failure, err
	}
	success := "Successfully added new group"
	return success, err
}

// 2. Glenn Assign groups to user

// add list of groups to string of groups in accounts and post it

// 3. Glenn Assign group to users

// add single group to multiple user list

// Glenn Assign groups to users

// add multiple groups to multiple user list
