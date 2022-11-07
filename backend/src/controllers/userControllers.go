package controllers

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"myModule/config"
	"myModule/src/entities"
	"myModule/src/models"
	"net/http"
)

func FetchUsers(w http.ResponseWriter, r *http.Request) {
	db, err := config.GetMySQLDB()
	if err != nil {
		fmt.Println(err)
	} else {
		defer db.Close()
		userModel := models.USERDB{
			Db: db,
		}
		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			log.Fatal("err")
		}
		auth := entities.Auth{}
		user := entities.CheckGroup{}
		err = json.Unmarshal(body, &auth)
		if err != nil {
			log.Fatal(err)
		}
		getUname, err := models.DegenJWT(auth.Token)
		if err != nil {
			msg := entities.Msg{
				Message: "You are not allow to view this page",
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		}
		user.Username = getUname
		if userModel.CheckGroup(user.Username, "admin") {
			result, err2 := userModel.GetAllUsers()
			if err2 != nil {
				fmt.Println(err2)
			} else {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(result)
			}
		} else {
			msg := entities.Msg{
				Message: "You are not allow to view this page",
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		}

	}
}

func FetchUser(w http.ResponseWriter, r *http.Request) {
	db, err := config.GetMySQLDB()
	if err != nil {
		fmt.Println(err)
	} else {
		defer db.Close()
		userModel := models.USERDB{
			Db: db,
		}
		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			log.Fatal("err")
		}
		// auth := entities.Auth{}
		user := entities.Users{}
		// userCheck := entities.CheckGroup{}
		err = json.Unmarshal(body, &user)
		if err != nil {
			log.Fatal(err)
		}
		getUname, err := models.DegenJWT(user.Editor)
		if err != nil {
			msg := entities.Msg{
				Message: "You are not allow to view this page",
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		}
		editor := getUname
		if userModel.CheckGroup(editor, "admin") || (user.Username == editor) {
			result, err2 := userModel.GetUser(user.Username)
			if err2 != nil {
				fmt.Println(err2)
			} else {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(result)
			}
		} else {
			msg := entities.Msg{
				Message: "You are not allow to view this page",
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		}
	}
}

func UpdateAllUserInfo(w http.ResponseWriter, r *http.Request) {
	db, err := config.GetMySQLDB()
	if err != nil {
		fmt.Println(err)
	} else {
		defer db.Close()
		userModel := models.USERDB{
			Db: db,
		}
		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			log.Fatal("err")
		}
		user := entities.Users{}
		err = json.Unmarshal(body, &user)
		if err != nil {
			log.Fatal(err)
		}

		message, err2 := userModel.UpdateAllUserInfo(user.Username, user.Password, user.Email, user.Status, user.BelongsTo, user.Editor)
		if err2 != nil {
			fmt.Println(err2)
		} else {
			msg := entities.Msg{
				Message: message,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		}
	}
}

func RevertUserPassword(w http.ResponseWriter, r *http.Request) {
	//making sure is a post request
	if r.Method != "POST" {
		http.Error(w, http.StatusText(405), http.StatusMethodNotAllowed)
		return
	}
	db, err := config.GetMySQLDB()
	if err != nil {
		fmt.Println(err)
	} else {
		defer db.Close()
		userModel := models.USERDB{
			Db: db,
		}
		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			log.Fatal("err")
		}
		user := entities.Users{}
		err = json.Unmarshal(body, &user)
		if err != nil {
			log.Fatal(err)
		}
		message, err2 := userModel.RevertUserPassword(user.Username, user.Password, user.Editor)
		if err2 != nil {
			fmt.Println(err2)
		} else {
			msg := entities.Msg{
				Message: message,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		}
	}
}

func UpdateAllUserInfoEP(w http.ResponseWriter, r *http.Request) {
	//making sure is a post request
	if r.Method != "POST" {
		http.Error(w, http.StatusText(405), http.StatusMethodNotAllowed)
		return
	}
	db, err := config.GetMySQLDB()
	if err != nil {
		fmt.Println(err)
	} else {
		defer db.Close()
		userModel := models.USERDB{
			Db: db,
		}
		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			log.Fatal("err")
		}
		user := entities.Users{}

		err = json.Unmarshal(body, &user)
		if err != nil {
			log.Fatal(err)
		}

		message, err2 := userModel.UpdateAllUserInfoEP(user.Username, user.Status, user.Email, user.BelongsTo, user.Editor)

		if err2 != nil {
			fmt.Println(err2)
		} else {
			msg := entities.Msg{
				Message: message,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		}
	}
}

func UpdateUserPassword(w http.ResponseWriter, r *http.Request) {
	//making sure is a post request
	if r.Method != "POST" {
		http.Error(w, http.StatusText(405), http.StatusMethodNotAllowed)
		return
	}
	db, err := config.GetMySQLDB()
	if err != nil {
		fmt.Println(err)
	} else {
		defer db.Close()
		userModel := models.USERDB{
			Db: db,
		}
		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			log.Fatal("err")
		}
		user := entities.Profile{}
		err = json.Unmarshal(body, &user)
		if err != nil {
			log.Fatal(err)
		}
		// message, err2 := userModel.UpdateUserEmail(user.Username, user.Status, user.Email, user.Editor)
		// if err2 != nil {
		// 	fmt.Println(err2)
		// } else {
		username, err := models.DegenJWT(user.Token)
		if err != nil {
			log.Fatal(err)
		}
		result, err := userModel.EditPassword(username, user.Password)
		if err != nil {
			log.Fatal(err)
		}
		msg := entities.Msg{
			Message: result,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(msg)
	}
}

func UpdateUserEmail(w http.ResponseWriter, r *http.Request) {
	//making sure is a post request
	if r.Method != "POST" {
		http.Error(w, http.StatusText(405), http.StatusMethodNotAllowed)
		return
	}
	db, err := config.GetMySQLDB()
	if err != nil {
		fmt.Println(err)
	} else {
		defer db.Close()
		userModel := models.USERDB{
			Db: db,
		}
		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			log.Fatal("err")
		}
		user := entities.Profile{}
		err = json.Unmarshal(body, &user)
		if err != nil {
			log.Fatal(err)
		}
		// message, err2 := userModel.UpdateUserEmail(user.Username, user.Status, user.Email, user.Editor)
		// if err2 != nil {
		// 	fmt.Println(err2)
		// } else {
		username, err := models.DegenJWT(user.Token)
		if err != nil {
			log.Fatal(err)
		}
		result, err := userModel.EditEmail(username, user.Email)
		if err != nil {
			log.Fatal(err)
		}
		msg := entities.Msg{
			Message: result,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(msg)
	}
}

// GIN Login
func Authenticate(w http.ResponseWriter, r *http.Request) {
	db, err := config.GetMySQLDB()
	if err != nil {
		fmt.Println(err)
	} else {
		defer db.Close()
		db := models.USERDB{
			Db: db,
		}
		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			log.Fatal("err")
		}
		user := entities.Users{}
		err = json.Unmarshal(body, &user)
		if err != nil {
			log.Fatal(err)
			msg := entities.Msg{
				Message: "Internal Server Error",
				Success: false,
				Code:    500,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
			return
		}
		result, err := db.Auth(user.Username, user.Password)
		if err != nil {
			log.Fatal(err)
		}
		if result {
			secret, e := models.GenerateJWT(user.Username)
			if e != nil {
				log.Fatal("err")
			}
			msg := entities.Msg{
				Message: secret,
				Success: result,
				Code:    200,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
			return
		} else {
			msg := entities.Msg{
				Message: "Invalid Username or Password",
				Success: result,
				Code:    403,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		}

	}
}

// GIN AUTHORIZATION
func Authorize(w http.ResponseWriter, r *http.Request) {
	db, err := config.GetMySQLDB()
	if err != nil {
		fmt.Println(err)
	} else {
		defer db.Close()
		db := models.USERDB{
			Db: db,
		}
		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			log.Fatal("err")
		}
		auth := entities.Auth{}
		user := entities.CheckGroup{}
		err = json.Unmarshal(body, &auth)
		if err != nil {
			log.Fatal(err)
		}
		getUname, err := models.DegenJWT(auth.Token)
		if err != nil {
			log.Fatal("Error: DegenJWT")
		}
		user.Username = getUname
		if db.CheckGroup(user.Username, auth.Group) {
			msg := entities.Msg{
				Message: "true",
				Success: true,
				Code:    200,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		} else {
			msg := entities.Msg{
				Message: "false",
				Success: false,
				Code:    200,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		}
	}
}

// func EditEmail(w http.ResponseWriter, r *http.Request) {

// 	db, err := config.GetMySQLDB()
// 	if err != nil {
// 		fmt.Println(err)
// 	} else {
// 		defer db.Close()
// 		userModel := models.USERDB{
// 			Db: db,
// 		}
// 		result, err2 := userModel.EditEmail(r)
// 		if err2 != nil {
// 			fmt.Println(err2)
// 		} else {
// 			fmt.Fprint(w, result)
// 		}
// 	}

// }

// func EditPassword(w http.ResponseWriter, r *http.Request) {

// 	db, err := config.GetMySQLDB()
// 	if err != nil {
// 		fmt.Println(err)
// 	} else {
// 		defer db.Close()
// 		userModel := models.USERDB{
// 			Db: db,
// 		}
// 		result, err2 := userModel.EditPassword(r)
// 		if err2 != nil {
// 			fmt.Println(err2)
// 		} else {
// 			fmt.Fprint(w, result)
// 		}
// 	}

// }

//GIN CreateUser
func CreateUser(w http.ResponseWriter, r *http.Request) {
	db, err := config.GetMySQLDB()
	if err != nil {
		fmt.Println(err)
	} else {
		defer db.Close()
		userModel := models.USERDB{
			Db: db,
		}

		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			log.Fatal("err")
		}
		user := entities.Users{}
		err = json.Unmarshal(body, &user)
		if err != nil {
			log.Fatal(err)
			msg := entities.Msg{
				Message: "Internal Server Error",
				Success: false,
				Code:    500,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
			return
		}
		hashpw, err := models.HashPassword(user.Password)
		if err != nil {
			log.Fatal(err)
		}
		res, err := userModel.CreateUser(user.Username, hashpw, user.Email)
		if err != nil {
			msg := entities.Msg{
				Message: "fail",
				Success: res,
				Code:    404,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		}
		if res {
			msg := entities.Msg{
				Message: "success",
				Success: res,
				Code:    200,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		} else {
			msg := entities.Msg{
				Message: "fail",
				Success: res,
				Code:    404,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(msg)
		}

	}
}
