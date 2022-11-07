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

// fetch all groups
func FetchGroups(w http.ResponseWriter, r *http.Request){
	db, err := config.GetMySQLDB()
	if err != nil {
		fmt.Println(err)
	} else {
		defer db.Close()
		groupModel := models.GROUPDB{
			Db: db,
		}
		result, err := groupModel.GetAllGroups()
		
		if err != nil {
			fmt.Println(err)
		} else {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(result)
			// fmt.Fprint(w, result)
		}
	}
}

//Create new group
func CreateGroup(w http.ResponseWriter, r *http.Request){

	db, err := config.GetMySQLDB()
	if err!= nil {
		fmt.Println(err)
	} else {
		defer db.Close()
		groupModel := models.GROUPDB{
			Db: db,
		}

		body, err := ioutil.ReadAll(r.Body)
		if err != nil {
			log.Fatal("err")
		}

		group := entities.Groups{}
		err = json.Unmarshal(body, &group)
		if err != nil {
			log.Fatal(err)
		}
		groupname := group.Groupname
		message, _ := groupModel.CreateNewGroup(groupname)
		msg := []entities.Msg{
			{Message: message},
		}
		// fmt.Println(msg)
			w.Header().Set("Content-Type", "application/json")
			if message == "Successfully Created"{
				w.WriteHeader(http.StatusCreated)
			} else if message == "Group already exists" {
				w.WriteHeader(http.StatusConflict)
			} else if message == "SQL database error" {
				w.WriteHeader(http.StatusInternalServerError)
			}
			json.NewEncoder(w).Encode(msg)
		
	}

}

